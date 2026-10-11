import { useRef, useState } from "react";
import { apiClient } from "@/shared/api/client";

import {
  Phone,
  X,
  Plus,
  FileText,
  Trash2
} from "lucide-react";

import { useCreateProject } from "../../context/CreateProjectContext";

import { showToast } from "@/components/ui/toast";

type Props = {
  open: boolean;
  onClose: () => void;
};

type TranscriptFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  base64: string;
  rawFile: File;
};

const CallRecordUploadModal = ({
  open,
  onClose
}: Props) => {

  const fileRef =
    useRef<HTMLInputElement>(null);

  const [files, setFiles] =
    useState<
      TranscriptFile[]
    >([]);

  const {
    projectData,
    setProjectData
  } = useCreateProject();


  if (!open)
    return null;



  /* convert file -> base64 */

  const fileToBase64 = (
    file: File
  ) => {

    return new Promise<string>(
      (
        resolve,
        reject
      ) => {

        const reader =
          new FileReader();

        reader.readAsDataURL(
          file
        );

        reader.onload = () =>
          resolve(
            reader.result as string
          );

        reader.onerror =
          reject;

      }
    );

  };



  const handleUpload =
    async (
      e: React.ChangeEvent<HTMLInputElement>
    ) => {
      const uploaded = e.target.files;
      if (!uploaded) return;

      const validFiles = Array.from(uploaded).filter(file => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        return ext && ['txt', 'mp3', 'wav', 'm4a'].includes(ext);
      });

      if (validFiles.length === 0) {
        showToast(
          "error",
          "Only .txt, .mp3, .wav, and .m4a files are allowed"
        );
        return;
      }

      const converted = await Promise.all(
        validFiles.map(async (file) => {
          const ext = file.name.split('.').pop()?.toLowerCase();
          let base64 = "";
          if (ext === "txt") {
            try {
              base64 = await fileToBase64(file);
            } catch (err) {
              console.error("Base64 conversion failed", err);
            }
          }
          return {
            id: crypto.randomUUID(),
            name: file.name,
            size: file.size,
            type: file.type,
            uploadedAt: new Date().toISOString(),
            base64,
            rawFile: file
          };
        })
      );

      setFiles(prev => [...prev, ...converted]);
    };



  const deleteFile = (
    id: string
  ) => {

    setFiles(
      prev =>
        prev.filter(
          file =>
            file.id !== id
        )
    );

  };



  const handleImport = async () => {
    if (files.length === 0) {
      showToast("error", "Upload transcript or audio files");
      return;
    }

    const projectId = projectData.formData.projectDetails.projectId || "temp-id";
    const uploadedRecords: any[] = [];

    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && ["mp3", "wav", "m4a"].includes(ext)) {
        try {
          const formData = new FormData();
          formData.append("file", file.rawFile);

          const response = await apiClient.post(
            `/projects/${projectId}/call-records/upload-audio`,
            formData,
            {
              headers: {
                "Content-Type": "multipart/form-data",
              },
            }
          );

          if (response.data?.success && response.data?.data?.callRecord) {
            uploadedRecords.push(response.data.data.callRecord);
          } else {
            uploadedRecords.push(file);
          }
        } catch (err) {
          console.error("Audio upload failed: ", err);
          uploadedRecords.push(file);
        }
      } else {
        uploadedRecords.push(file);
      }
    }

    setProjectData(
      prev => ({
        ...prev,
        integrations: {
          ...prev.integrations,
          transcripts: {
            integrated: true,
            data: [...(prev.integrations.transcripts?.data || []), ...uploadedRecords]
          }
        }
      })
    );

    localStorage.setItem(
      "projectTranscripts",
      JSON.stringify(uploadedRecords)
    );

    showToast(
      "success",
      `${files.length} call record${files.length > 1 ? "s" : ""} successfully added to project`
    );

    setFiles([]);
    onClose();
  };



  return (

    <div
      className="
fixed
inset-0
bg-black/50
z-50
flex
items-center
justify-center
px-4
"
    >


      <div
        className="
bg-white
rounded-xl
w-full
max-w-[520px]
max-h-[55vh]
overflow-hidden
flex
flex-col
"
      >
        {/* Header */}

        <div className="p-6 relative">

          <div className="flex items-center gap-3">

            <div className="
w-10
h-10
rounded-full
bg-gray-100
flex
items-center
justify-center
">

              <Phone size={20} />

            </div>

            <div>

              <h2
                className="
font-semibold
text-lg
"
              >
                Upload Call Transcripts
              </h2>

            </div>

            <button
              onClick={onClose}
              className="
absolute
top-5
right-5
bg-red-500
text-white
rounded-md
px-2
py-1
hover:cursor-pointer
"
            >
              <X size={18} />
            </button>

          </div>

        </div>


        {/* Body */}

        <div
          className="
px-5
pb-5
flex
flex-col
items-center
flex-1
min-h-0
"
        >

          <p
            className="
text-sm
text-gray-500
mb-5
"
          >
            Capture key information from customer calls by uploading transcripts
          </p>


          {/* upload button */}

          <div
            onClick={() =>
              fileRef.current?.click()
            }
            className="
border-2
border-dashed
border-gray-300
rounded-md
py-2
flex
justify-center
items-center
gap-2
text-sm
cursor-pointer
w-[95%]
hover:border-red-500

"
          >

            <Plus size={18} />

            Add Call Record

          </div>

          <input
            hidden
            multiple
            accept=".txt,.mp3,.wav,.m4a"
            ref={fileRef}
            type="file"
            onChange={
              handleUpload
            }
          />



          {/* uploaded files */}


          <div
            className="
w-[95%]
mt-6
space-y-3
h-[220px]
overflow-y-auto
pr-2
no-scrollbar
"
          >

            {
              files.length === 0 && (

                <div
                  className="
h-full
flex
items-center
justify-center
text-sm
text-gray-400
"
                >
                  No transcripts uploaded
                </div>

              )
            }

            {files.map(
              file => (

                <div
                  key={file.id}
                  className="
flex
items-center
justify-between
border
border-gray-200
bg-gray-50
rounded-md
px-4
py-3
hover:border hover:border-red-500
"
                >

                  <div
                    className="
flex
items-center
gap-3
"
                  >

                    <FileText
                      size={18}
                      className="
text-red-500
"
                    />

                    <span
                      className="
text-sm
truncate
"
                    >
                      {file.name}
                    </span>

                  </div>


                  <button
                    onClick={() =>
                      deleteFile(
                        file.id
                      )
                    }
                    className="hover:cursor-pointer"
                  >

                    <Trash2
                      size={18}
                      className="
text-red-500
"
                    />

                  </button>

                </div>

              )
            )}

          </div>

        </div>


        {/* Footer */}

        <div className="p-5">

          <button
            onClick={
              handleImport
            }
            disabled={
              files.length === 0
            }
            className="
w-full
py-2
rounded-md
bg-red-500
text-white

disabled:bg-gray-200
disabled:text-gray-400
"
          >
            Confirm Import
          </button>

        </div>

      </div>

    </div>

  );

};

export default CallRecordUploadModal;