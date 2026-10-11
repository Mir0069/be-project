import os

file_path = "src/features/sales-manager/projects/pages/Projects.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Add FilterSelect component
filter_select = """
const FilterSelect = ({ label, value, options, onChange }: any) => {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none flex items-center gap-2 pl-4 pr-10 py-2 bg-white border border-gray-200 rounded-md text-sm text-gray-700 hover:border-red-500 outline-none transition cursor-pointer"
      >
        <option value="All">{label}</option>
        {options.map((opt: string) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-4 top-3 text-gray-500 pointer-events-none" />
    </div>
  );
};
"""
content = content.replace("const PER_PAGE = 8;", filter_select + "\nconst PER_PAGE = 8;")


# Add statusFilter state
content = content.replace("const [updatedFilter, setUpdatedFilter] = useState<string>(\"all\");", "const [updatedFilter, setUpdatedFilter] = useState<string>(\"all\");\n  const [statusFilter, setStatusFilter] = useState(\"All\");")

# Update filteredRows to include statusFilter
old_filter_rows = """    return rows.filter((row) => {
      if (!matchesPeriod(updatedFilter, row.dateForFilter)) return false;
      if (!term) return true;
      return (
        row.name.toLowerCase().includes(term) ||
        row.reference.toLowerCase().includes(term) ||
        row.customer.toLowerCase().includes(term)
      );
    });"""

new_filter_rows = """    return rows.filter((row) => {
      if (statusFilter !== "All" && row.status !== statusFilter) return false;
      if (!matchesPeriod(updatedFilter, row.dateForFilter)) return false;
      if (!term) return true;
      return (
        row.name.toLowerCase().includes(term) ||
        row.reference.toLowerCase().includes(term) ||
        row.customer.toLowerCase().includes(term)
      );
    });"""
content = content.replace(old_filter_rows, new_filter_rows)

# Add FilterSelect to UI
old_ui = """      <div className="flex flex-wrap items-center gap-3 mt-8">
        <div className="relative">"""

new_ui = """      <div className="flex flex-wrap items-center gap-3 mt-8">
        <FilterSelect 
          label="By Status"
          value={statusFilter}
          onChange={(v: string) => { setStatusFilter(v); reset(); }}
          options={["Not started", "In-progress", "Pending", "Completed"]}
        />
        <div className="relative">"""
content = content.replace(old_ui, new_ui)

with open(file_path, "w") as f:
    f.write(content)
