import mongoose, { Document, Schema } from 'mongoose';

export interface ISequenceDocument extends Omit<Document, '_id'> {
  _id: string; // The sequence name, e.g., 'PRJ-2026'
  sequenceValue: number;
}

const SequenceSchema = new Schema<ISequenceDocument>({
  _id: { type: String, required: true },
  sequenceValue: { type: Number, default: 0 }
});

export const Sequence = mongoose.model<ISequenceDocument>('Sequence', SequenceSchema);
