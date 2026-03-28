// Copyright GraphCaster. All Rights Reserved.

import type { TFunction } from "i18next";

import type { GraphDocumentParseError } from "./parseDocument";

export type OpenGraphErrorPresentation = {
  title: string;
  message: string;
  copyText: string;
};

function messageKeyForParseError(error: GraphDocumentParseError): string {
  switch (error.kind) {
    case "not_object":
      return "app.errors.openModal.not_object";
    case "invalid_meta":
      return "app.errors.openModal.invalid_meta";
    case "invalid_viewport":
      return "app.errors.openModal.invalid_viewport";
    case "invalid_schema_version":
      return error.scope === "root"
        ? "app.errors.openModal.invalid_schema_version_root"
        : "app.errors.openModal.invalid_schema_version_meta";
    case "nodes_not_array":
      return "app.errors.openModal.nodes_not_array";
    case "edges_not_array":
      return "app.errors.openModal.edges_not_array";
    case "invalid_node": {
      const base = "app.errors.openModal.invalid_node";
      if (error.reason === "not_object") {
        return `${base}_not_object`;
      }
      if (error.reason === "id") {
        return `${base}_id`;
      }
      if (error.reason === "data") {
        return `${base}_data`;
      }
      return `${base}_position`;
    }
    case "invalid_edge": {
      const base = "app.errors.openModal.invalid_edge";
      if (error.reason === "not_object") {
        return `${base}_not_object`;
      }
      if (error.reason === "id") {
        return `${base}_id`;
      }
      if (error.reason === "endpoints") {
        return `${base}_endpoints`;
      }
      if (error.reason === "data") {
        return `${base}_data`;
      }
      return `${base}_empty`;
    }
    case "invalid_graph_id":
      return error.scope === "meta"
        ? "app.errors.openModal.invalid_graph_id_meta"
        : "app.errors.openModal.invalid_graph_id_root";
    case "schema_normalize_failed":
      return error.scope === "root"
        ? "app.errors.openModal.schema_normalize_root"
        : "app.errors.openModal.schema_normalize_meta";
    default: {
      const x: never = error;
      throw new Error(`unhandled parse error: ${String(x)}`);
    }
  }
}

export type OpenGraphErrorPresentationOptions = {
  fileName?: string;
};

function titleForOpenError(t: TFunction, opts?: OpenGraphErrorPresentationOptions): string {
  const fn = opts?.fileName?.trim();
  if (fn) {
    return t("app.errors.openModal.titleWithFile", { fileName: fn });
  }
  return t("app.errors.openModal.title");
}

export function presentationForParseError(
  t: TFunction,
  error: GraphDocumentParseError,
  presentationOpts?: OpenGraphErrorPresentationOptions,
): OpenGraphErrorPresentation {
  const key = messageKeyForParseError(error);
  const opts =
    error.kind === "invalid_node" || error.kind === "invalid_edge" ? { index: error.index } : undefined;
  const message = t(key, opts);
  const title = titleForOpenError(t, presentationOpts);
  const fn = presentationOpts?.fileName?.trim();
  const body = `${message}\n\n${JSON.stringify(error)}`;
  const copyText = fn ? `${fn}\n\n${body}` : body;
  return { title, message, copyText };
}

export function presentationForJsonSyntaxError(
  t: TFunction,
  err: unknown,
  presentationOpts?: OpenGraphErrorPresentationOptions,
): OpenGraphErrorPresentation {
  const title = titleForOpenError(t, presentationOpts);
  const rawMsg = err instanceof Error ? err.message : String(err);
  const prefix = t("app.errors.openModal.json_invalid_prefix");
  const message = rawMsg.trim() === "" ? prefix : `${prefix} ${rawMsg}`;
  const fn = presentationOpts?.fileName?.trim();
  const detailForCopy = rawMsg.trim() === "" ? prefix : `${prefix} ${rawMsg}`;
  const copyText = fn ? `${fn}\n\n${detailForCopy}` : detailForCopy;
  return { title, message, copyText };
}

export function presentationForReadFailure(
  t: TFunction,
  presentationOpts?: OpenGraphErrorPresentationOptions,
): OpenGraphErrorPresentation {
  const title = titleForOpenError(t, presentationOpts);
  const message = t("app.errors.openModal.read_failed");
  const fn = presentationOpts?.fileName?.trim();
  const copyText = fn ? `${fn}\n\n${message}` : message;
  return { title, message, copyText };
}
