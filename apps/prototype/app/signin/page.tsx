import { Suspense } from "react";
import { SignInFlow } from "./SignInFlow";

export const metadata = { title: "Sign in · Waybill prototype" };

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInFlow />
    </Suspense>
  );
}
