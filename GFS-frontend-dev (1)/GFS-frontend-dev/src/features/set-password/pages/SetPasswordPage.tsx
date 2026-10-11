
// import {
//   useState,
// } from "react";

// import {
//   useNavigate,
//   useSearchParams,
// } from "react-router-dom";

// import {
//   Lock,
// } from "lucide-react";

// import { Form } from "@/components/ui/Form";

// import { showToast } from "@/components/ui/toast";

// import {
//   showValidationToast,
// } from "@/components/ui/validationtoast";

// import {
//   setPasswordSchema,
// } from "../validation/setPasswordSchema";

// import {
//   useSetPassword,
// } from "../query/set-password.query";

// const SetPasswordPage = () => {

//   const navigate =
//     useNavigate();

//   const [searchParams] =
//     useSearchParams();

//   const token =
//     searchParams.get(
//       "token"
//     );

//   const setPasswordMutation =
//     useSetPassword();

//   const [
//     formData,
//     setFormData,
//   ] = useState({
//     password: "",
//     confirmPassword: "",
//   });

//   const [
//     errors,
//     setErrors,
//   ] = useState<
//     Record<string, string>
//   >({});

//   const handleChange = (
//     e: React.ChangeEvent<HTMLInputElement>
//   ) => {

//     const {
//       name,
//       value,
//     } = e.target;

//     setFormData(
//       (prev) => ({
//         ...prev,
//         [name]: value,
//       })
//     );

//     setErrors(
//       (prev) => ({
//         ...prev,
//         [name]: "",
//       })
//     );

//   };

//   const validateForm =
//     () => {

//       const result =
//         setPasswordSchema.safeParse(
//           formData
//         );

//       if (
//         result.success
//       ) {
//         return {};
//       }

//       const newErrors:
//         Record<
//           string,
//           string
//         > = {};

//       result.error.issues.forEach(
//         (err) => {

//           const field =
//             err.path[0] as string;

//           if (
//             !newErrors[
//             field
//             ]
//           ) {
//             newErrors[
//               field
//             ] =
//               err.message;
//           }

//         }
//       );

//       showValidationToast(
//         "error",
//         Object.values(
//           newErrors
//         ).join(" | "),
//         "set-password-error"
//       );

//       return newErrors;

//     };

//   const handleSubmit = (
//     e: React.FormEvent
//   ) => {

//     e.preventDefault();

//     if (!token) {

//       showToast(
//         "error",
//         "Invalid or expired link"
//       );

//       return;

//     }

//     const validationErrors =
//       validateForm();

//     if (
//       Object.keys(
//         validationErrors
//       ).length > 0
//     ) {

//       setErrors(
//         validationErrors
//       );

//       return;

//     }

//     setPasswordMutation.mutate(
//       {
//         token,
//         password:
//           formData.password,
//       },

//       {

//         onSuccess:
//           () => {

//             showToast(
//               "success",
//               "Password set successfully"
//             );

//             navigate(
//               "/login"
//             );

//           },

//         onError:
//           (
//             error: any
//           ) => {

//             showToast(
//               "error",
//               error?.error
//                 ?.message ||

//               "Failed to set password"
//             );

//           },

//       }
//     );

//   };

//   return (


//     <div className="min-h-screen bg-gray-100 p-8">

//       <div className="border-l-3 border-red-500 px-4">
//         <div className="text-2xl font-medium text-red-500 leading-[1.9rem]">
//           Set Password Page
//         </div>

//         <div className="text-md text-gray-500 mt-2">
//           Set your password, confirm it and then login into your account.
//         </div>
//       </div>

//       <div className="flex items-center justify-center w-full mt-25">

//         <div className="w-full max-w-md bg-white rounded-xl shadow-lg px-6 py-7">

//           <div className="mb-8">

//             <h1 className="text-2xl font-semibold text-red-500">
//               Set Password
//             </h1>

//             <p className="text-sm text-gray-500 mt-2">
//               Create your password to continue.
//             </p>

//           </div>

//           <Form.Wrapper
//             onSubmit={
//               handleSubmit
//             }
//             className="space-y-5"
//           >

//             <div>

//               <label className="block text-red-500 font-medium mb-2 text-sm">
//                 Password
//               </label>

//               <div className="relative">

//                 <Lock
//                   size={18}
//                   className="absolute left-3 top-3 text-red-500"
//                 />

//                 <Form.Input
//                   type="password"
//                   name="password"
//                   placeholder="Enter password"
//                   value={
//                     formData.password
//                   }
//                   onChange={
//                     handleChange
//                   }
//                   error={
//                     errors.password
//                   }
//                   inputClassName={
//                     errors.password
//                       ? "pl-10 pr-4 bg-[#A6A5A5]/10 border-red-500 border-2 outline-none focus:outline-none rounded-md"
//                       : "pl-10 pr-4 bg-[#A6A5A5]/10 border-gray-300 outline-none focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 rounded-md"
//                   }
//                 />

//               </div>

//             </div>

//             <div>

//               <label className="block text-red-500 font-medium mb-2 text-sm">
//                 Confirm Password
//               </label>

//               <div className="relative">

//                 <Lock
//                   size={18}
//                   className="absolute left-3 top-3 text-red-500"
//                 />

//                 <Form.Input
//                   type="password"
//                   name="confirmPassword"
//                   placeholder="Confirm password"
//                   value={
//                     formData.confirmPassword
//                   }
//                   onChange={
//                     handleChange
//                   }
//                   error={
//                     errors.confirmPassword
//                   }
//                   inputClassName={
//                     errors.password
//                       ? "pl-10 pr-4 bg-[#A6A5A5]/10 border-red-500 border-2 outline-none focus:outline-none rounded-md"
//                       : "pl-10 pr-4 bg-[#A6A5A5]/10 border-gray-300 outline-none focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 rounded-md"
//                   }
//                 />

//               </div>

//             </div>

//             <Form.Button
//               disabled={
//                 setPasswordMutation.isPending
//               }
//               text={
//                 setPasswordMutation.isPending
//                   ? "Saving..."
//                   : "Set Password"
//               }
//               className="w-full mt-4 bg-red-500 hover:bg-red-600 py-2 rounded-md font-semibold"
//             />

//           </Form.Wrapper>

//         </div>
//       </div>
//     </div>

//   );

// };

// export default SetPasswordPage;


import {
  useState,
} from "react";

import {
  useNavigate,
  useSearchParams,
  useLocation,
  Link,
} from "react-router-dom";

import {
  Lock,
} from "lucide-react";

import { Form } from "@/components/ui/Form";
import PasswordRequirements from "@/features/auth/components/PasswordRequirements";

import { showToast } from "@/components/ui/toast";

import {
  showValidationToast,
} from "@/components/ui/validationtoast";

import {
  setPasswordSchema,
} from "../validation/setPasswordSchema";

import {
  useSetPassword,
} from "@/features/set-password/query/set-password.query";

const getSetPasswordErrorMessage = (error: any, fallback: string): string =>
  error?.data?.error?.message ||
  error?.response?.data?.error?.message ||
  error?.data?.message ||
  error?.response?.data?.message ||
  (typeof error?.message === "string" && !error.message.startsWith("Request failed with status code")
    ? error.message
    : fallback);

const SetPasswordPage = () => {

  const navigate =
    useNavigate();

  const location =
    useLocation();

  const isResetPassword =
    location.pathname ===
    "/reset-password";

  const [searchParams] =
    useSearchParams();

  const token =
    searchParams.get(
      "token"
    );

  const setPasswordMutation =
    useSetPassword();

  const [
    formData,
    setFormData,
  ] = useState({
    password: "",
    confirmPassword: "",
  });

  const [
    errors,
    setErrors,
  ] = useState<
    Record<string, string>
  >({});

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {

    const {
      name,
      value,
    } = e.target;

    setFormData(
      (prev) => ({
        ...prev,
        [name]: value,
      })
    );

    setErrors(
      (prev) => ({
        ...prev,
        [name]: "",
      })
    );

  };

  const validateForm =
    () => {

      const result =
        setPasswordSchema.safeParse(
          formData
        );

      if (
        result.success
      ) {
        return {};
      }

      const newErrors:
        Record<
          string,
          string
        > = {};

      result.error.issues.forEach(
        (err) => {

          const field =
            err.path[0] as string;

          if (
            !newErrors[
            field
            ]
          ) {

            newErrors[
              field
            ] =
              err.message;

          }

        }
      );

      showValidationToast(
        "error",
        Object.values(
          newErrors
        ).join(" | "),
        isResetPassword
          ? "reset-password-error"
          : "set-password-error"
      );

      return newErrors;

    };

  const handleSubmit = (
    e: React.FormEvent
  ) => {

    e.preventDefault();

    if (!token) {

      showToast(
        "error",
        "Invalid or expired link"
      );

      return;

    }

    const validationErrors =
      validateForm();

    if (
      Object.keys(
        validationErrors
      ).length > 0
    ) {

      setErrors(
        validationErrors
      );

      return;

    }

    setPasswordMutation.mutate(
      {
        token,
        password:
          formData.password,
      },

      {

        onSuccess:
          () => {

            showToast(
              "success",

              isResetPassword
                ? "Password reset successfully. Please sign in with your new password."
                : "Password set successfully"
            );

            navigate(
              "/login",
              { replace: true }
            );

          },

        onError:
          (
            error: any
          ) => {

            showToast(
              "error",

              getSetPasswordErrorMessage(
                error,
                isResetPassword
                  ? "Failed to reset password"
                  : "Failed to set password"
              )
            );

          },

      }
    );

  };

  return (

    <div className="min-h-screen bg-[#E9EBF2] flex items-center justify-center px-4">

      <div className="w-full max-w-md bg-white rounded-xl shadow-lg px-8 py-10">

        <div className="mb-8">

          <h1 className="text-2xl font-semibold text-red-500">

            {isResetPassword
              ? "Reset Password"
              : "Set Password"}

          </h1>

          <p className="text-sm text-gray-500 mt-2">

            {isResetPassword

              ? "Create a new password for your account."

              : "Create your password to continue."}

          </p>

        </div>

        <Form.Wrapper
          onSubmit={
            handleSubmit
          }
          className="space-y-5"
        >

          <div>

            <label className="block text-red-500 font-medium mb-2 text-sm">

              {isResetPassword
                ? "New Password"
                : "Password"}

            </label>

            <div className="relative">

              <Lock
                size={18}
                className="absolute left-3 top-3 text-red-500"
              />

              <Form.Input
                type="password"
                name="password"
                placeholder={
                  isResetPassword
                    ? "Enter new password"
                    : "Enter password"
                }
                value={
                  formData.password
                }
                onChange={
                  handleChange
                }
                error={
                  errors.password
                }
                inputClassName="pl-10 py-2 text-sm bg-[#A6A5A5]/10 border-gray-300 rounded-md focus:ring-1 focus:ring-red-500 focus:border-red-500"
              />

            </div>

            <PasswordRequirements password={formData.password} />

          </div>

          <div>

            <label className="block text-red-500 font-medium mb-2 text-sm">

              Confirm Password

            </label>

            <div className="relative">

              <Lock
                size={18}
                className="absolute left-3 top-3 text-red-500"
              />

              <Form.Input
                type="password"
                name="confirmPassword"
                placeholder="Confirm password"
                value={
                  formData.confirmPassword
                }
                onChange={
                  handleChange
                }
                error={
                  errors.confirmPassword
                }
                inputClassName="pl-10 py-2 text-sm bg-[#A6A5A5]/10 border-gray-300 rounded-md focus:ring-1 focus:ring-red-500 focus:border-red-500"
              />

            </div>

          </div>

          <Form.Button
            disabled={
              setPasswordMutation.isPending
            }
            text={
              setPasswordMutation.isPending

                ? (
                  isResetPassword
                    ? "Resetting..."
                    : "Saving..."
                )

                : (
                  isResetPassword
                    ? "Reset Password"
                    : "Set Password"
                )
            }
            className="w-full mt-4 bg-red-500 hover:bg-red-600 py-2 rounded-md font-semibold"
          />

          <Link
            to="/login"
            className="block text-center text-sm font-medium text-gray-500 transition hover:text-red-500"
          >
            Back to login
          </Link>

        </Form.Wrapper>

      </div>

    </div>

  );

};

export default SetPasswordPage;
