/**
 * Vite's `?raw` suffix imports a file as a string. Used by the theme test to
 * read the stylesheets it asserts about — deliberately in preference to
 * `node:fs`, which would mean adding Node types to a browser app's tsconfig and
 * inviting Node APIs into `src/`.
 */
declare module "*?raw" {
  const contents: string;
  export default contents;
}
