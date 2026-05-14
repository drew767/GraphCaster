// Copyright GraphCaster. All Rights Reserved.

export interface TemplatePayload {
  id: string;
  name: string;
  workflow: Record<string, unknown>;
}

export interface TemplatesApi {
  get: (id: string) => Promise<TemplatePayload | null>;
}

export const templatesApi: TemplatesApi = {
  async get(id) {
    // Stub: production wires to a template service.
    return { id, name: `Template ${id}`, workflow: { nodes: [], edges: [] } };
  },
};
