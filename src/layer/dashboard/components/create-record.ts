import {
  api,
  button,
  checkbox,
  type Child,
  css,
  type DashboardCollection,
  type DashboardField,
  drawer,
  h,
  labeledField,
  textInput,
  useT,
} from 'ohne/dashboard';
import {
  isDecimalString,
  isInteger,
  isRealNumber,
  isUndefined,
  type Ref,
  ref,
  sleep,
} from 'ohne/utils';

css`
  .create-record-error {
    min-height: 20px;
    margin: 16px 0 12px;
    font-size: 12px;
    color: var(--danger);
  }
`;

/**
 * The new-record drawer: one labeled input per writable scalar field, driven by the metadata.
 * Relation lists, composites, and blocks start from their defaults and edit later in the sheet.
 * An empty input omits its field, so declared defaults apply and required fields answer per field.
 * Client parsing catches malformed numbers; everything else lands as the server's `422` per field.
 * `onDone(true)` reports a created record; closing without creating reports `false`.
 */
export function createRecord(
  collection: DashboardCollection,
  onDone: (created: boolean) => void,
): Child {
  const t = useT();
  const formFields = collection.fields.filter(formField);
  const texts = new Map<string, Ref<string>>();
  const bools = new Map<string, Ref<boolean>>();
  for (const field of formFields) {
    if (field.logicalType === 'boolean') bools.set(field.name, ref(false));
    else texts.set(field.name, ref(''));
  }
  const errors = ref<Readonly<Record<string, string>>>(blankErrors());
  const failure = ref('');
  const busy = ref(false);
  let settled = false;

  const finish = (created: boolean): void => {
    if (settled) return;
    settled = true;
    onDone(created);
  };

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (busy.value) return;
    const body: Record<string, unknown> = {};
    const invalid = blankErrors();
    for (const field of formFields) {
      const outcome = parseField(field, texts.get(field.name), bools.get(field.name), t);
      if (!isUndefined(outcome.error)) invalid[field.name] = outcome.error;
      else if (!isUndefined(outcome.value)) body[field.name] = outcome.value;
    }
    errors.value = invalid;
    failure.value = '';
    if (Object.keys(invalid).length > 0) return;
    busy.value = true;
    void send(collection.segment, body).then((outcome) => {
      busy.value = false;
      if (outcome.created) {
        finish(true);
        return;
      }
      if (!isUndefined(outcome.errors)) {
        errors.value = outcome.errors;
        failure.value = orphanError(outcome.errors, formFields);
        return;
      }
      failure.value = t(
        outcome.failure === 'unreachable' ? 'dashboard.unreachable' : 'dashboard.writeFailed',
      );
    });
  };

  const firstText = formFields.find((field) => field.logicalType !== 'boolean')?.name;

  return drawer(
    { title: () => t('dashboard.newRecord'), onClose: () => finish(false) },
    h(
      'form',
      { onSubmit: submit },
      formFields.map((field) =>
        labeledField(
          () => (field.required ? `${field.label} *` : field.label),
          control(field, texts.get(field.name), bools.get(field.name), field.name === firstText),
          () => errors.value[field.name] ?? '',
        ),
      ),
      h('div', { class: 'create-record-error' }, () => failure.value),
      button(() => t('dashboard.create'), { type: 'submit', disabled: () => busy.value }),
    ),
  );
}

/**
 * The first error keyed off the rendered fields, so a failure the form cannot place still shows.
 * The server keys by dot path and hooks may key anywhere, including the record root `''`.
 */
function orphanError(
  errors: Readonly<Record<string, string>>,
  formFields: readonly DashboardField[],
): string {
  const rendered = new Set(formFields.map((field) => field.name));
  for (const [key, message] of Object.entries(errors)) {
    if (!rendered.has(key)) return message;
  }
  return '';
}

/**
 * Whether the field renders in the create form: writable scalars and single relations only.
 */
function formField(field: DashboardField): boolean {
  if (!field.writable) return false;
  if (field.kind === 'record') return true;
  if (field.kind !== 'column') return false;
  return field.logicalType !== 'json' || field.type === 'roles';
}

/**
 * The field's form control: a checkbox for booleans, a typed text input otherwise.
 */
function control(
  field: DashboardField,
  text: Ref<string> | undefined,
  bool: Ref<boolean> | undefined,
  autofocus: boolean,
): Child {
  if (!isUndefined(bool)) return checkbox(bool);
  if (isUndefined(text)) return null;
  return textInput(text, {
    type: field.type === 'password' ? 'password' : 'text',
    autofocus,
  });
}

/**
 * Parses one field's form state into its wire value.
 * An empty input resolves to no value, so the field is omitted and its default applies.
 */
function parseField(
  field: DashboardField,
  text: Ref<string> | undefined,
  bool: Ref<boolean> | undefined,
  t: (key: 'dashboard.invalidInteger' | 'dashboard.invalidNumber') => string,
): { value?: unknown; error?: string } {
  if (!isUndefined(bool)) return { value: bool.value };
  if (isUndefined(text)) return {};
  const raw = text.value.trim();
  if (raw === '') return {};
  if (field.logicalType === 'integer') {
    if (!isDecimalString(raw) || !isInteger(Number(raw))) {
      return { error: t('dashboard.invalidInteger') };
    }
    return { value: Number(raw) };
  }
  if (field.logicalType === 'real') {
    if (!isDecimalString(raw) || !isRealNumber(Number(raw))) {
      return { error: t('dashboard.invalidNumber') };
    }
    return { value: Number(raw) };
  }
  if (field.type === 'roles') {
    return {
      value: raw
        .split(',')
        .map((role) => role.trim())
        .filter((role) => role !== ''),
    };
  }
  return { value: text.value };
}

/**
 * Sends the create, retrying once on a busy `503`.
 * A `422` maps its per-field errors; other failures carry their kind for the form's error line.
 */
async function send(
  segment: string,
  body: Record<string, unknown>,
): Promise<{
  created: boolean;
  errors?: Record<string, string>;
  failure?: 'unreachable' | 'writeFailed';
}> {
  const post = (): Promise<Response> =>
    api(`POST /collections/${segment}`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    let response = await post();
    if (response.status === 503) {
      await sleep(1000);
      response = await post();
    }
    if (response.ok) return { created: true };
    if (response.status === 422) {
      const answer = (await response.json()) as { data?: { errors?: Record<string, string> } };
      return { created: false, errors: Object.assign(blankErrors(), answer.data?.errors ?? {}) };
    }
    return { created: false, failure: 'writeFailed' };
  } catch {
    return { created: false, failure: 'unreachable' };
  }
}

/**
 * A fresh error map with no prototype, since field paths may collide with `Object` keys.
 */
function blankErrors(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}
