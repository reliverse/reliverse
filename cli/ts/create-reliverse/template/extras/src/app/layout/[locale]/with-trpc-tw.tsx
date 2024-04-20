import "~/core/styles/globals.css";

import { Inter } from "next/font/google";

// @ts-expect-error ...
import { TRPCReactProvider } from "~/core/utils/trpc/react";

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-sans",
});

export const metadata = {
	title: "Create Reliverse App with Internalization",
	description: "Generated by Reliverse CLI",
	icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		// @ts-expect-error ...
		<html lang="en">
			{/* @ts-expect-error ... */}
			<body className={`font-sans ${inter.variable}`}>
				{/* @ts-expect-error ... */}
				<TRPCReactProvider>{children}</TRPCReactProvider>
			</body>
		</html>
	);
}
