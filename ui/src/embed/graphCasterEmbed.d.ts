// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "../graph/types";
import type { GraphDocumentParseError, ParseGraphDocumentJsonResult } from "../graph/parseDocument";

export type { GraphDocumentJson, GraphDocumentParseError, ParseGraphDocumentJsonResult };

export declare function loadGraph(input: string | unknown): ParseGraphDocumentJsonResult;

export declare const GraphCasterEmbed: {
  readonly loadGraph: typeof loadGraph;
};
