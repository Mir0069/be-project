import os

# 1. We need to update src/features/projects/components/OverviewPanel.tsx to include the assignment UI.
file_path = "src/features/projects/components/OverviewPanel.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Add imports for hooks and UI
imports = """import { FileText, MapPin, User, Users, X } from "lucide-react";
import { useState } from "react";
import { useProject, useUpdateProjectEstimators, useEstimators } from "@/features/projects/query/projectsQuery";"""
content = content.replace('import { FileText, MapPin, User, Users } from "lucide-react";', imports)

# Update the component body to include the hooks
old_func_start = """export const OverviewPanel = ({ project }: { project: ApiProject }) => {
  const source = getSourceMeta(project.creationSource);"""

new_func_start = """export const OverviewPanel = ({ project: apiProject }: { project: ApiProject }) => {
  const source = getSourceMeta(apiProject.creationSource);
  
  const { data: project } = useProject(apiProject.id);
  const { data: estimatorsData } = useEstimators();
  const updateEstimatorMutation = useUpdateProjectEstimators();

  const [selectedEstimatorId, setSelectedEstimatorId] = useState("");

  const estimators = estimatorsData || [];
  const assignedEstimators = project?.assignedEstimators || [];

  const handleAddEstimator = () => {
    if (!selectedEstimatorId) return;
    if (assignedEstimators.some((e: any) => e.id === selectedEstimatorId)) return;

    const newEstimatorIds = [
      ...assignedEstimators.map((e: any) => e.id),
      selectedEstimatorId
    ];

    updateEstimatorMutation.mutate({
      id: apiProject.id,
      estimatorIds: newEstimatorIds,
    });
    setSelectedEstimatorId("");
  };

  const handleRemoveEstimator = (estimatorId: string) => {
    const newEstimatorIds = assignedEstimators
      .filter((e: any) => e.id !== estimatorId)
      .map((e: any) => e.id);

    updateEstimatorMutation.mutate({
      id: apiProject.id,
      estimatorIds: newEstimatorIds,
    });
  };

  const projectObj = apiProject;
"""
content = content.replace(old_func_start, new_func_start)
content = content.replace("project.", "projectObj.")

# Replace the static Estimator card with the dynamic one
old_estimator_card = """      <SectionCard title="Estimator" icon={<User size={16} />}>
        <FieldGrid>
          <Field label="Name" value={projectObj.estimatorName} />
          <Field label="Email" value={projectObj.estimatorEmail} />
          <Field label="Phone" value={projectObj.estimatorPhone} />
        </FieldGrid>
      </SectionCard>"""

new_estimator_card = """      <SectionCard title="Assigned Estimators" icon={<Users size={16} />}>
        <div className="mb-4 flex gap-3">
          <select
            value={selectedEstimatorId}
            onChange={(e: any) => setSelectedEstimatorId(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 flex-1 max-w-xs"
          >
            <option value="">[ Select Estimator ]</option>
            {estimators
              .filter((e: any) => !assignedEstimators.some((ae: any) => ae.id === e.id))
              .map((e: any) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleAddEstimator}
            disabled={!selectedEstimatorId || updateEstimatorMutation.isPending}
            className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateEstimatorMutation.isPending ? "Adding..." : "Add Estimator"}
          </button>
        </div>

        {assignedEstimators.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-gray-800 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4 font-medium">Name</th>
                  <th className="py-3 px-4 font-medium">Email</th>
                  <th className="py-3 px-4 font-medium w-24">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {assignedEstimators.map((estimator: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-medium text-gray-800">
                      {estimator.name || `${estimator.firstName || ''} ${estimator.lastName || ''}`.trim()}
                    </td>
                    <td className="py-3 px-4">{estimator.email}</td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleRemoveEstimator(estimator.id)}
                        disabled={updateEstimatorMutation.isPending}
                        className="text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                        title="Remove Estimator"
                      >
                        <X size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500 italic">No estimators assigned yet.</p>
        )}
      </SectionCard>"""

content = content.replace(old_estimator_card, new_estimator_card)

with open(file_path, "w") as f:
    f.write(content)

