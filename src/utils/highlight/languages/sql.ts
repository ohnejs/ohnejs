import type { HighlightToken } from '../highlight-token.ts';

import { scanTokens, type HighlightClassifier } from '../scan-tokens.ts';
import { captureGroup } from './_capture-group.ts';

const KEYWORDS = new Set(
  `SELECT FROM WHERE AND OR NOT IN IS NULL TRUE FALSE AS ON USING JOIN INNER LEFT RIGHT FULL OUTER CROSS
   NATURAL LATERAL GROUP BY ORDER HAVING LIMIT OFFSET FETCH FIRST LAST NEXT ROWS ONLY DISTINCT ALL ANY SOME
   UNION INTERSECT EXCEPT CASE WHEN THEN ELSE END EXISTS BETWEEN LIKE ILIKE GLOB ESCAPE ASC DESC NULLS
   INSERT INTO VALUES UPDATE SET DELETE RETURNING MERGE MATCHED CONFLICT DO NOTHING REPLACE CREATE ALTER
   DROP TRUNCATE RENAME TO ADD COLUMN TABLE VIEW INDEX UNIQUE PRIMARY KEY FOREIGN REFERENCES CONSTRAINT
   CHECK DEFAULT COLLATE IF TEMP TEMPORARY DATABASE SCHEMA SEQUENCE TRIGGER FUNCTION PROCEDURE RETURNS
   BEGIN COMMIT ROLLBACK TRANSACTION SAVEPOINT RELEASE GRANT REVOKE WITH RECURSIVE OVER PARTITION WINDOW
   RANGE CASCADE RESTRICT AUTOINCREMENT AUTO_INCREMENT GENERATED ALWAYS STORED VIRTUAL CAST FILTER
   EXPLAIN ANALYZE PRAGMA VACUUM ATTACH DETACH WITHOUT STRICT ZONE TOP
   CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER`.split(/\s+/),
);

const TYPES = new Set(
  `INT INTEGER SMALLINT BIGINT TINYINT MEDIUMINT SERIAL SMALLSERIAL BIGSERIAL DECIMAL NUMERIC REAL FLOAT
   DOUBLE PRECISION MONEY BOOLEAN BOOL BIT CHAR CHARACTER VARCHAR VARYING NCHAR NVARCHAR TEXT CLOB BLOB
   BYTEA BINARY VARBINARY DATE TIME TIMESTAMP TIMESTAMPTZ DATETIME INTERVAL UUID JSON JSONB XML`.split(
    /\s+/,
  ),
);

const GRAMMAR =
  /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|([EeNnXxBb]?'(?:[^'\n]|'')*'?|\$([A-Za-z_]\w*)?\$[\s\S]*?(?:\$\3\$|$))|("(?:[^"\n]|"")*"?|`(?:[^`\n]|``)*`?)|(0[xX][\da-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)|::|(\$\d+|\?\d*|@@?[A-Za-z_][\w$]*|:[A-Za-z_]\w*)|([A-Za-z_][\w$]*)|\s+|[^\s\w$'"`?:@./-]+|[\s\S]/y;

const CALLABLE = new Set(['REPLACE', 'LEFT', 'RIGHT']);

const DIGIT = /\d/;

/**
 * A word after `.` is a column or a schema-qualified call, never a keyword.
 * A keyword stays a keyword before `(`, unless it also names a function, as `LEFT(` does.
 * A type directly followed by `(` and a digit is sized; any other word before `(` is a function.
 */
const classify: HighlightClassifier = (match, code) => {
  switch (captureGroup(match)) {
    case 1:
      return 'comment';
    case 2:
      return 'string';
    case 4:
      return 'property';
    case 5:
      return 'number';
    case 6:
      return 'variable';
    case 7: {
      const word = match[0].toUpperCase();
      const end = match.index + word.length;
      const call = code.charAt(end) === '(';
      if (code.charAt(match.index - 1) === '.') return call ? 'function' : 'property';
      if (KEYWORDS.has(word) && !(call && CALLABLE.has(word))) return 'keyword';
      if (call) return TYPES.has(word) && DIGIT.test(code.charAt(end + 1)) ? 'type' : 'function';
      return TYPES.has(word) ? 'type' : undefined;
    }
    default:
      return undefined;
  }
};

/**
 * Tokenizes SQL across its common dialects.
 * Keywords and types match in any case.
 * A quoted identifier is a property, a bound parameter is a variable.
 * An unterminated string ends at its line; an unterminated block comment or dollar quote runs to the end.
 *
 * @example
 * ```ts
 * tokenizeSQL('select count(*) from t where id = $1')
 * // -> [
 * //   { kind: 'keyword', start: 0, end: 6 },
 * //   { kind: 'function', start: 7, end: 12 },
 * //   { kind: 'keyword', start: 16, end: 20 },
 * //   { kind: 'keyword', start: 23, end: 28 },
 * //   { kind: 'variable', start: 34, end: 36 },
 * // ]
 * ```
 */
export function tokenizeSQL(code: string): HighlightToken[] {
  return scanTokens(code, GRAMMAR, classify);
}
