import { isTableRowDivider, type MultilineElementTransformer } from "@lexical/markdown";
import {
  $createTableNodeWithDimensions,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import { $createTextNode, $isParagraphNode, type ElementNode } from "lexical";

function parseRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function fillRow(rowNode: ElementNode, values: string[]) {
  const cellNodes = rowNode.getChildren().filter($isTableCellNode);
  cellNodes.forEach((cellNode, i) => {
    const text = values[i] ?? "";
    const paragraph = cellNode.getFirstChild();
    if (text && $isParagraphNode(paragraph)) {
      paragraph.append($createTextNode(text));
    }
  });
}

/** GFM markdown tables <-> TableNode, since @lexical/table ships no markdown transformer. */
export const TABLE_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node) => {
    if (!$isTableNode(node)) return null;
    const rows = node.getChildren().filter($isTableRowNode);
    if (rows.length === 0) return null;

    const lines: string[] = [];
    rows.forEach((row, rowIndex) => {
      const cells = row.getChildren().filter($isTableCellNode);
      const cellTexts = cells.map((cell) =>
        cell.getTextContent().replace(/\|/g, "\\|").replace(/\n/g, " ").trim(),
      );
      lines.push(`| ${cellTexts.join(" | ")} |`);
      if (rowIndex === 0) {
        lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
      }
    });
    return lines.join("\n");
  },
  regExpStart: /^\|(.*)\|[ \t]*$/,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
    const headerLine = lines[startLineIndex];
    const dividerLine = lines[startLineIndex + 1];
    if (headerLine === undefined || dividerLine === undefined || !isTableRowDivider(dividerLine)) {
      return null;
    }

    const headerCells = parseRow(headerLine);
    const bodyRows: string[][] = [];
    let endLineIndex = startLineIndex + 1;
    for (let i = startLineIndex + 2; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined || !line.trim().startsWith("|")) break;
      bodyRows.push(parseRow(line));
      endLineIndex = i;
    }

    const tableNode = $createTableNodeWithDimensions(1 + bodyRows.length, headerCells.length, true);
    const rowNodes = tableNode.getChildren().filter($isTableRowNode);

    const headerRow = rowNodes[0];
    if (headerRow) fillRow(headerRow, headerCells);
    bodyRows.forEach((values, i) => {
      const rowNode = rowNodes[i + 1];
      if (rowNode) fillRow(rowNode, values);
    });

    rootNode.append(tableNode);
    return [true, endLineIndex];
  },
  replace: () => false,
  type: "multiline-element",
};
