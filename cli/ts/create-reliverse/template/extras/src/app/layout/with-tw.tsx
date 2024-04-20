import "~/core/styles/globals.css";

import { Inter } from "next/font/google";

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-sans",
});

export const metadata = {
	title: "Create Reliverse App",
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
			<body className={`font-sans ${inter.variable}`}>{children}</body>
		</html>
	);
}
