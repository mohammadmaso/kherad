declare module "mammoth" {
  export interface ConvertToHtmlResult {
    value: string;
    messages: unknown[];
  }

  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<ConvertToHtmlResult>;
}
