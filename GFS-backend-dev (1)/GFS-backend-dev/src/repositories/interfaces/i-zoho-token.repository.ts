import type { ZohoStoredToken } from '@features/zoho/zoho.types';

export interface IUpsertTokenFields {
  accessToken: string;
  refreshToken: string;
  apiDomain: string;
  scope?: string;
  expiresAt: Date;
}

export interface IZohoTokenRepository {
  findByAccountKey(accountKey: string): Promise<ZohoStoredToken | null>;
  upsertToken(accountKey: string, fields: IUpsertTokenFields): Promise<ZohoStoredToken>;
}
