import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <SignUp
        appearance={{
          variables: {
            colorPrimary: "#E9863B",
            colorBackground: "#1a1510",
            colorInputBackground: "rgba(255,255,255,0.04)",
            colorInputText: "#e2e8f0",
            colorText: "#e2e8f0",
            colorTextSecondary: "rgba(255,255,255,0.5)",
            borderRadius: "0.75rem",
          },
          elements: {
            card: "glass-strong",
          },
        }}
      />
    </div>
  );
}
