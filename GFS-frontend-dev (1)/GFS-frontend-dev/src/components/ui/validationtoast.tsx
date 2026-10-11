import { toast } from "sonner";

type ToastType =
  | "success"
  | "error";

export const showValidationToast = (
  type: ToastType,
  message: string,
  id?: string
) => {

  const commonConfig = {
    id,
    duration: 2500,
  };

  switch (type) {
    case "success":
      toast.success(
        message,
        commonConfig
      );
      break;

    case "error":
      toast.error(
        message,
        commonConfig
      );
      break;

    default:
      toast(
        message,
        commonConfig
      );
  }
};