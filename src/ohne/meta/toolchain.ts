import pkg from '../../../package.json' with { type: 'json' };

/**
 * The toolchain pins a scaffolded project starts with.
 */
export interface Toolchain {
  /**
   * The exact `@types/node` and `typescript` versions to install.
   */
  devDependencies: { '@types/node': string; typescript: string };

  /**
   * The Node.js range the project runs on.
   */
  engines: { node: string };
}

/**
 * The toolchain ohne itself is checked against, sourced from `package.json`.
 * A new project pins the same versions, so it type-checks ohne's shipped `.ts` exactly as ohne does.
 */
export const toolchain: Toolchain = {
  devDependencies: {
    '@types/node': pkg.devDependencies['@types/node'],
    typescript: pkg.devDependencies.typescript,
  },
  engines: { node: pkg.engines.node },
};
