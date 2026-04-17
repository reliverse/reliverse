import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@repo/ui/accordion";

const faqs = [
  {
    question: "What technologies does Reliverse specialize in?",
    answer:
      "We specialize in modern web technologies including TanStack Start, Next.js, Vite, React, TypeScript, Bun, Node.js, and various cloud platforms. Our team stays current with the latest trends and best practices in web development.",
  },
  {
    question: "Are Reliverse products open source?",
    answer:
      "Many of our developer tools like Relivator, Versator, Dler, and Rse CLI are open source. We believe in giving back to the community and fostering collaboration. Check our GitHub for available repositories.",
  },
  {
    question: "How can I contribute to Reliverse projects?",
    answer:
      "We welcome contributions! You can start by checking out our open source projects on GitHub, reading the contribution guidelines, and submitting pull requests. For our Relinka project, you can even earn Blefcoins for completing tasks.",
  },
  {
    question: "What is the Reliverse ecosystem?",
    answer:
      "The Reliverse ecosystem is a collection of interconnected digital products spanning multiple domains including developer tools, CLIs, commerce solutions, entertainment, and lifestyle applications. All products are designed to work together seamlessly.",
  },
  {
    question: "Do you offer custom development services?",
    answer:
      "Yes! Beyond our product portfolio, we offer custom development services including full-stack development, UI/UX design, cloud solutions, and consulting. Contact us to discuss your project needs.",
  },
  {
    question: "How can I stay updated on new releases?",
    answer:
      "Subscribe to our newsletter for the latest updates, follow us on GitHub for code releases, and check our blog for announcements and technical articles.",
  },
];

export function FaqSection() {
  return (
    <section className="py-20 sm:py-32" id="faq">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Frequently Asked Questions
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Everything you need to know about Reliverse and our products
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-3xl">
          <Accordion className="space-y-4">
            {faqs.map((faq, index) => (
              <AccordionItem
                className="rounded-lg border border-border/50 bg-card/50 px-6 backdrop-blur-sm"
                key={index}
                value={`item-${index}`}
              >
                <AccordionTrigger className="text-left hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
