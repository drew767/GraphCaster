// Copyright GraphCaster. All Rights Reserved.

export interface TemplateMeta {
  id: string;
  title: string;
  description: string;
  badge: string | null;
  frameworks: string[];
  usecases: string[];
  author: string;
  tags: string[];
  previewImage: string | null;
}

export interface MarketplaceListResponse {
  items: TemplateMeta[];
  configured: boolean;
}
