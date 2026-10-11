import { useCallback, useRef, useState } from "react";
import type {
  FieldFeedbackAnswers,
  FieldFeedbackInput,
  FieldFeedbackRequest,
} from "@/shared/types/fieldFeedback.types";

/**
 * Asks for one optional reason per changed field, one modal at a time.
 *
 * `collect` resolves once every request has been answered or skipped, so a
 * screen can await it inside its Update handler and then save with the answers
 * attached. Skipping resolves that key to null; the value still saves.
 */
export const useFieldFeedbackQueue = () => {
  const [queue, setQueue] = useState<FieldFeedbackRequest[]>([]);
  const [index, setIndex] = useState(0);
  const answersRef = useRef<FieldFeedbackAnswers>({});
  const resolveRef = useRef<((answers: FieldFeedbackAnswers) => void) | null>(null);

  const collect = useCallback(
    (requests: FieldFeedbackRequest[]): Promise<FieldFeedbackAnswers> => {
      if (requests.length === 0) return Promise.resolve({});

      answersRef.current = {};
      setQueue(requests);
      setIndex(0);

      return new Promise<FieldFeedbackAnswers>((resolve) => {
        resolveRef.current = resolve;
      });
    },
    []
  );

  const advance = (answer: FieldFeedbackInput | null) => {
    const current = queue[index];
    if (current) answersRef.current[current.key] = answer;

    if (index + 1 >= queue.length) {
      const resolve = resolveRef.current;
      resolveRef.current = null;
      setQueue([]);
      setIndex(0);
      resolve?.(answersRef.current);
      return;
    }

    setIndex(index + 1);
  };

  return {
    collect,
    modalProps: {
      open: queue.length > 0,
      request: queue[index] ?? null,
      position: { index: index + 1, total: queue.length },
      onSkip: () => advance(null),
      onSave: (feedback: FieldFeedbackInput) => advance(feedback),
    },
  };
};
