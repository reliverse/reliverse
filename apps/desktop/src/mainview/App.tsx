import { useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 to-purple-600 text-gray-900">
      <div className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="mb-2 text-center text-5xl font-bold text-white drop-shadow-lg">
          React + Tailwind + Vite
        </h1>
        <p className="mb-10 text-center text-xl text-white/90">
          A fast Electrobun app with hot module replacement
        </p>

        <div className="mb-8 rounded-xl bg-white p-8 shadow-xl">
          <h2 className="mb-4 text-2xl font-semibold text-indigo-600">Interactive Counter</h2>
          <p className="mb-4 text-gray-600">
            Click the button below to test React state. With HMR enabled, you can edit this
            component and see changes instantly without losing state! :)
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCount((c) => c + 1)}
              className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white shadow-md transition-colors hover:bg-indigo-700 hover:shadow-lg"
            >
              Count: {count}
            </button>
            <button
              onClick={() => setCount(0)}
              className="rounded-lg bg-gray-200 px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-300"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="mb-8 rounded-xl bg-white p-8 shadow-xl">
          <h2 className="mb-4 text-2xl font-semibold text-indigo-600">Getting Started</h2>
          <ul className="space-y-3 text-gray-700">
            <li className="flex items-start gap-2">
              <span className="font-bold text-indigo-500">1.</span>
              <span>
                Run <code className="rounded bg-gray-100 px-2 py-1 text-sm">bun run dev</code> for
                development without HMR
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-indigo-500">2.</span>
              <span>
                Run <code className="rounded bg-gray-100 px-2 py-1 text-sm">bun run dev:hmr</code>{" "}
                for development with hot reload
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-indigo-500">3.</span>
              <span>
                Run <code className="rounded bg-gray-100 px-2 py-1 text-sm">bun run build</code> to
                build for production
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-xl bg-white p-8 shadow-xl">
          <h2 className="mb-4 text-2xl font-semibold text-indigo-600">Stack</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-gray-50 p-4 text-center">
              <div className="mb-2 text-3xl">⚡</div>
              <div className="font-medium">Electrobun</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-4 text-center">
              <div className="mb-2 text-3xl">⚛️</div>
              <div className="font-medium">React</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-4 text-center">
              <div className="mb-2 text-3xl">🎨</div>
              <div className="font-medium">Tailwind</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-4 text-center">
              <div className="mb-2 text-3xl">🔥</div>
              <div className="font-medium">Vite HMR</div>
            </div>
          </div>
        </div>

        <div className="mt-10 rounded-lg bg-white/10 p-6 text-center text-white/80 backdrop-blur">
          <p>
            Edit <code className="rounded bg-white/20 px-2 py-1 text-sm">src/mainview/App.tsx</code>{" "}
            and save to see HMR in action
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
