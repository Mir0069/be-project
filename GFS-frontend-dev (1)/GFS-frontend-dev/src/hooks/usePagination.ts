import { useMemo, useState } from "react";

export const usePagination = <T,>(items: T[], perPage = 15) => {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * perPage;

  const pageItems = useMemo(
    () => items.slice(start, start + perPage),
    [items, start, perPage]
  );

  return {
    page: safePage,
    setPage,
    totalPages,
    perPage,
    total: items.length,
    pageItems,
    rangeStart: items.length === 0 ? 0 : start + 1,
    rangeEnd: Math.min(start + perPage, items.length),
    reset: () => setPage(1),
    next: () => setPage((p) => Math.min(p + 1, totalPages)),
    prev: () => setPage((p) => Math.max(p - 1, 1)),
  };
};

export default usePagination;
