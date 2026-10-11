import type { IProposalDoc } from '@db/models/proposal.model';
import type { IDomainProposal } from './proposal.types';

export function toDomainProposal(doc: IProposalDoc & { _id?: any, createdAt?: any, updatedAt?: any }): IDomainProposal {
  return {
    publicId: doc.publicId,
    projectId: doc.projectId.toString(),
    schemaVersion: doc.schemaVersion,
    schema: doc.schema,
    versions: doc.versions,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
