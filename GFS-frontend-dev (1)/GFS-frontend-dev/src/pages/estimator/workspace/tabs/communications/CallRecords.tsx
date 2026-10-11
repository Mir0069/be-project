// pages/estimator/workspace/tabs/communications/CallRecords.tsx

import { useState } from "react";
import { FileText, Play, Search } from "lucide-react";
// import RowMenu from "../../components/RowMenu";
// import { callRecordings } from "../../mockData";
const callRecordings: any[] = [];

const CallRecords = () => {
  const [search, setSearch] = useState("");

  const filtered = callRecordings.filter((c: any) =>
    c.fileName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-base font-semibold text-gray-800">
          Communications Hub - Call Records
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Listen back to all your project calls
        </p>
      </header>

      <div className="relative max-w-3xl">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
        <input
          value={search}
          onChange={(e: any) => setSearch(e.target.value)}
          placeholder="Search Call Records..."
          className="w-full bg-white border border-gray-200 rounded-md pl-9 pr-3 py-2 text-sm outline-none focus:border-red-500"
        />
      </div>

      <ul className="space-y-3 max-w-3xl">
        {filtered.map((c: any) => (
          <li
            key={c.id}
            className="bg-white border border-gray-200 rounded-md p-3 flex items-center gap-3"
          >
            <div className="w-8 h-8 rounded bg-gray-800 flex items-center justify-center shrink-0">
              <FileText size={14} className="text-white" />
            </div>

            <span className="flex-1 truncate text-sm text-gray-700">
              {c.fileName}
            </span>

            <button
              type="button"
              aria-label="Play"
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-700 hover:bg-gray-100 transition"
            >
              <Play size={14} fill="currentColor" />
            </button>

            {/* RowMenu */}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CallRecords;
