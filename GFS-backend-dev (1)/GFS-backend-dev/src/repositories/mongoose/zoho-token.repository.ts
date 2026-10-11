import { ZohoTokenModel } from '@db/models/zoho-token.model';
import type { ZohoStoredToken } from '@features/zoho/zoho.types';
import type { IUpsertTokenFields, IZohoTokenRepository } from '../interfaces/i-zoho-token.repository';

export class MongooseZohoTokenRepository implements IZohoTokenRepository {
  public async findByAccountKey(accountKey: string): Promise<ZohoStoredToken | null> {
    const doc = await ZohoTokenModel.findOne({ accountKey }).lean();
    if (!doc) return null;
    return {
      accessToken: doc.accessToken,
      refreshToken: doc.refreshToken,
      apiDomain: doc.apiDomain,
      expiresAt: doc.expiresAt,
      scope: doc.scope ?? undefined,
    };
  }

  public async upsertToken(accountKey: string, fields: IUpsertTokenFields): Promise<ZohoStoredToken> {
    const doc = await ZohoTokenModel.findOneAndUpdate(
      { accountKey },
      { accountKey, ...fields },
      { upsert: true, new: true },
    ).lean();
    return {
      accessToken: doc.accessToken,
      refreshToken: doc.refreshToken,
      apiDomain: doc.apiDomain,
      expiresAt: doc.expiresAt,
      scope: doc.scope ?? undefined,
    };
  }
}
