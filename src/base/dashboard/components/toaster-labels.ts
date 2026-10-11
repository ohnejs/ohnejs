import { type ToasterOptions, useT } from 'ohnejs/dashboard';

/**
 * The toaster's accessible names, live in the dashboard language.
 * Both layouts pass them to `base`, so the shared outlet speaks the language whichever screen mounted it.
 */
export function toasterLabels(): ToasterOptions {
  const t = useT();
  return {
    label: () => t('dashboard.toaster.label'),
    closeLabel: () => t('dashboard.toaster.close'),
  };
}
