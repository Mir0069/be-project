// components/ui/toast.tsx
import { toast } from "sonner";

type ToastType = "success" | "error";

export const showToast = (
  type: ToastType,
  message: string
) => {
  const commonConfig = {
    duration: 2500,
  };

  switch (type) {
    case "success":
      toast.success(message, commonConfig);
      break;

    case "error":
      toast.error(message, commonConfig);
      break;

    default:
      toast(message, commonConfig);
  }
};


