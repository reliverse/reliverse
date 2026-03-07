import { useChat } from "@ai-sdk/react";
import { env } from "@repo/env/vite";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { DefaultChatTransport } from "ai";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";

export function AiPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `${env.VITE_API_URL}/ai`,
    }),
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="mx-auto grid w-full grid-rows-[1fr_auto] overflow-hidden p-4">
      <div className="space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 ? (
          <div className="mt-8 text-center text-muted-foreground">
            Ask me anything to get started!
          </div>
        ) : (
          messages.map((message) => (
            <div
              className={`rounded-lg p-3 ${
                message.role === "user" ? "ml-8 bg-primary/10" : "mr-8 bg-secondary/20"
              }`}
              key={message.id}
            >
              <p className="mb-1 text-sm font-semibold">
                {message.role === "user" ? "You" : "AI Assistant"}
              </p>
              {message.parts?.map((part, index) => {
                if (part.type === "text") {
                  return (
                    <Streamdown
                      isAnimating={status === "streaming" && message.role === "assistant"}
                      key={index}
                    >
                      {part.text}
                    </Streamdown>
                  );
                }
                return null;
              })}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="flex w-full items-center space-x-2 border-t pt-2" onSubmit={handleSubmit}>
        <Input
          autoComplete="off"
          autoFocus
          className="flex-1"
          name="prompt"
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          value={input}
        />
        <Button size="icon" type="submit">
          <Send size={18} />
        </Button>
      </form>
    </div>
  );
}
