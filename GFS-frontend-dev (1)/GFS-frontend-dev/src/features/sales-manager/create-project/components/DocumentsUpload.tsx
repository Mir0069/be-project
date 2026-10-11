import {
  FileText,
  FileArchive,
  Image,
  Upload,
  FileSearch,
  Trash2
} from "lucide-react";
import { showToast } from "@/components/ui/toast";
import { openStagedBlobInWindow } from "@/shared/lib/filePreview";
import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import { useCreateProject } from "../context/CreateProjectContext";

type UploadedFile = {

  id: string;

  projectId: string;

  name: string;

  size: number;

  type: string;

  base64: string;

  uploadedAt: string;

};

const DocumentsUploadModule = () => {

  const {
    projectData,
    setProjectData
  } = useCreateProject();


  const fileInputRef =
    useRef<HTMLInputElement>(null);


  const [files, setFiles] =
    useState<UploadedFile[]>(

      projectData
        .formData
        .documents || []

    );


  const acceptedTypes =
    ".pdf,.docx,.txt,.jpg,.jpeg,.png";

  const [isDragging, setIsDragging] =
    useState(false);

  const allowedExtensions = new Set([
    "pdf",
    "docx",
    "txt",
    "jpg",
    "jpeg",
    "png"
  ]);



  /* convert file to base64 */

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

        reader.onload =
          () => resolve(
            reader.result as string
          );

        reader.onerror =
          reject;

      }

    );

  };


  const handleView = async (
    file: UploadedFile
  ) => {

    const extension =
      file.name
        .split(".")
        .pop()
        ?.toLowerCase();

    const previewable = [
      "pdf",
      "jpg",
      "jpeg",
      "png",
      "txt",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "csv"
    ];

    if (
      previewable.includes(
        extension || ""
      )
    ) {

      const newWindow = window.open("", "_blank");

      if (!newWindow)
        return;
      try {
        const blob = await fetch(file.base64).then((response) => response.blob());
        await openStagedBlobInWindow(blob, newWindow, file.name);
      } catch {
        newWindow.close();
        showToast("error", "Failed to open file");
      }
      return;

    }


    /* docx download */

    const link =
      document.createElement(
        "a"
      );

    link.href =
      file.base64;

    link.download =
      file.name;

    document.body.appendChild(
      link
    );

    link.click();

    document.body.removeChild(
      link
    );

  };


  const uploadFiles =
    async (uploadedFiles: File[]) => {

      if (uploadedFiles.length === 0)
        return;

      const cadExtensions = ["dwg", "dxf", "cad"];
      const hasCadFile = uploadedFiles.some(f => {
        const ext = f.name.split(".").pop()?.toLowerCase();
        return cadExtensions.includes(ext || "");
      });
      if (hasCadFile) {
        showToast("error", "CAD and DWG files are not supported. Please upload PDF, DOCX, TXT, or image files.");
      }

      const validFiles = uploadedFiles.filter(file => {

        const extension =
          file.name
            .split(".")
            .pop()
            ?.toLowerCase();

        return allowedExtensions.has(
          extension || ""
        );

      });

      const converted = await Promise.all(
        validFiles.map(

          async file => ({

            id:
              crypto.randomUUID(),

            projectId:

              projectData
                .formData
                .projectDetails
                .projectId ||

              "temp-project",


            name:
              file.name,

            size:
              file.size,

            type:
              file.type,

            base64:

              await fileToBase64(
                file
              ),

            uploadedAt:

              new Date()
                .toISOString()

          })

        )

      );

      const updated = [

        ...files,
        ...converted

      ];


      setFiles(
        updated
      );


      setProjectData(
        prev => ({

          ...prev,

          formData: {

            ...prev.formData,

            documents:
              updated

          }

        })
      );

      showToast(
        "success",
        `${converted.length} file${converted.length > 1
          ? "s"
          : ""
        } uploaded successfully`
      );


    };

  const handleUpload =
    async (
      e: ChangeEvent<HTMLInputElement>
    ) => {

      await uploadFiles(
        Array.from(e.target.files ?? [])
      );

      e.target.value = "";

    };

  const handleDragEnter = (
    e: DragEvent<HTMLDivElement>
  ) => {

    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.types.includes("Files"))
      setIsDragging(true);

  };

  const handleDragOver = (
    e: DragEvent<HTMLDivElement>
  ) => {

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setIsDragging(true);

  };

  const handleDragLeave = (
    e: DragEvent<HTMLDivElement>
  ) => {

    e.preventDefault();
    e.stopPropagation();

    if (
      e.currentTarget === e.target ||
      !e.currentTarget.contains(e.relatedTarget as Node | null)
    ) {
      setIsDragging(false);
    }

  };

  const handleFileDrop = (
    e: DragEvent<HTMLDivElement>
  ) => {

    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    void uploadFiles(
      Array.from(e.dataTransfer.files)
    );

  };



  const deleteFile = (
    id: string
  ) => {

    const updated =

      files.filter(

        file =>

          file.id !== id

      );


    setFiles(
      updated
    );


    setProjectData(
      prev => ({

        ...prev,

        formData: {

          ...prev.formData,

          documents:
            updated

        }

      })
    );

  };



  const formatSize = (
    bytes: number
  ) => {

    if (
      bytes < 1024
    )
      return `${bytes}B`;


    if (
      bytes <
      1024 * 1024
    ) {

      return `${(
        bytes / 1024
      ).toFixed(2)} KB`;

    }

    return `${(
      bytes /
      1024 /
      1024
    ).toFixed(2)} MB`;

  };


  const getFileIcon = (
    fileName: string
  ) => {

    const ext =
      fileName
        .split(".")
        .pop()
        ?.toLowerCase();


    switch (ext) {

      case "pdf":

        return (
          <FileText
            size={26}
            className="
          text-red-500
          "
          />
        );


      case "doc":

      case "docx":

        return (
          <FileText
            size={26}
            className="
          text-blue-500
          "
          />
        );


      case "jpg":

      case "jpeg":

      case "png":

        return (
          <Image
            size={26}
            className="
          text-green-500
          "
          />
        );

      case "txt":

        return (
          <FileText
            size={26}
            className="
      text-green-500
      "
          />
        );


      default:

        return (
          <FileText
            size={26}
            className="
          text-gray-400
          "
          />
        );

    }

  };



  const handleContinue = () => {

    setProjectData(
      prev => ({

        ...prev,

        navigation: {

          ...prev.navigation,

          currentStep: 6

        }

      })
    );

  };


  const handleBack = () => {

    setProjectData(
      prev => ({

        ...prev,

        navigation: {

          ...prev.navigation,

          currentStep: 4

        }

      })
    );

  };

  const toContinue =
    files.length === 0;

  return (

    <div className="bg-white rounded-xl w-full h-full flex flex-col p-6">

      <div className="shrink-0">

        <h1 className="text-2xl font-semibold text-red-500">
          Documents
        </h1>

        <p className="text-sm text-gray-500 mt-1">
          Upload required project documents
        </p>

      </div>


      <div className="flex-1 min-h-0 mt-6 pr-2 overflow-y-auto no-scrollbar">

        <div className="space-y-10 flex flex-col items-center">

          <div
            onClick={() =>
              fileInputRef.current?.click()
            }
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleFileDrop}
            aria-label="Upload project documents"
            className={`
border-2 border-dashed
rounded-xl
min-h-[100px]
w-[85%]
px-8 py-8
flex flex-col
justify-center
items-center
cursor-pointer
transition
${isDragging
  ? "border-red-600 bg-red-50 ring-2 ring-red-200"
  : "border-red-500 hover:bg-gray-50"
}
`}
          >

            <div className="
w-10 h-10
rounded-full
bg-gray-100
flex items-center justify-center
">

              <Upload
                size={24}
                className="text-red-500"
              />

            </div>

            <h3 className="mt-2 text-md font-medium text-red-500">
              {isDragging
                ? "Drop files to upload"
                : "Click to upload or drag and drop"
              }
            </h3>

            <p className="text-gray-500 text-sm">
              PDF, DOCX, TXT or JPG/JPEG/PNG
            </p>


            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="
mt-8
px-6
py-2
text-sm
rounded-md
bg-red-500
text-white
hover:bg-red-600
hover:cursor-pointer
"
            >

              Browse Files

            </button>


            <input
              hidden
              multiple
              ref={fileInputRef}
              type="file"
              accept={acceptedTypes}
              onChange={handleUpload}
            />

          </div>



          <div
            className="
w-[95%]
bg-white
rounded-xl
border
border-gray-300
overflow-hidden
"
          >

            <div className="px-5 py-3 border-b border-gray-300">

              <h1 className="font-semibold text-md text-red-500">
                Uploaded Files
              </h1>

            </div>


            {files.length === 0 ? (

              <div className="py-12 text-center text-gray-500">

                No files uploaded

              </div>

            ) : (

              <div className="max-h-[300px] overflow-y-auto no-scrollbar">

                {files.map(

                  (file, index) => (

                    <div

                      key={file.id}

                      className={`px-5 py-4 flex items-center justify-between hover:cursor-pointer

${index !== files.length - 1

                          ? "border-b border-gray-300"

                          : ""

                        }

`}

                    >

                      <div className="flex items-center gap-5 min-w-0">

                        {getFileIcon(
                          file.name
                        )}

                        <p
                          className="
truncate
text-sm
mb-1
font-medium
text-gray-800
hover:text-red-500
"
                        >

                          {file.name}

                        </p>

                      </div>


                      <div className="
flex
items-center
gap-10
shrink-0
">

                        <span className="text-gray-600">

                          {formatSize(
                            file.size
                          )}

                        </span>

                        <div className="
flex
items-center
gap-6
shrink-0
">

                          <button
                            type="button"
                            onClick={() =>
                              handleView(
                                file
                              )
                            }
                            title={`Preview ${file.name}`}
                            aria-label={`Preview ${file.name}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                          >

                            <FileSearch
                              size={20}
                              className="
hover:cursor-pointer
"
                            />

                          </button>


                          <button
                            type="button"
                            onClick={() =>
                              deleteFile(
                                file.id
                              )
                            }
                          >

                            <Trash2
                              size={20}
                              className="
text-red-500
hover:cursor-pointer
"
                            />

                          </button>

                        </div>

                      </div>

                    </div>

                  )

                )}

              </div>

            )}

          </div>

        </div>

      </div>


      <div className="shrink-0 flex items-center justify-between px-4 pt-4">

        <button
          type="button"
          onClick={handleBack}
          className="
px-5 py-0.5 rounded-full
text-md
bg-transparent
hover:cursor-pointer
border border-gray-500
text-gray-800
hover:border hover:border-red-500
hover:text-red-500
"
        >

          Back

        </button>

        <button
          type="button"
          onClick={handleContinue}
          className="
    px-8
    py-1
    rounded-md
    transition-colors
    duration-200

    bg-red-500
    text-white
    hover:bg-red-600
    hover:cursor-pointer
  "
        >
          {toContinue ? "Skip" : "Continue"}
        </button>
      </div>

    </div>

  );

};

export default DocumentsUploadModule;
