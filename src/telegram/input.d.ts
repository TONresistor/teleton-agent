declare module "input" {
  function text(prompt: string): Promise<string>;
  export = { text };
}
