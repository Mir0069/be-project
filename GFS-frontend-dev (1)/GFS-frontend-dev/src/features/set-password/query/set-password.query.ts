import { useMutation } from "@tanstack/react-query";

import {
  setPassword,
} from "@/services/set-password";

export const useSetPassword =
  () => {

    return useMutation({
      mutationFn:
        setPassword,
    });

};

