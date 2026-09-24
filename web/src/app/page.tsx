import Link from "next/link";
import { Button } from "@/components/ui/button";
import { segmentLabels } from "@/lib/validations";

const features = [
  {
    title: "Agenda online 24h",
    description:
      "Seus clientes marcam horário sozinhos, a qualquer hora, sem ligação.",
  },
  {
    title: "Página pública exclusiva",
    description: "Um link só seu, com sua marca, serviços e profissionais.",
  },
  {
    title: "Controle total",
    description:
      "Serviços, profissionais, horários, folgas e clientes em um só painel.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-white">
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold text-zinc-900">
            Aureon Agenda
          </span>
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
            >
              Entrar
            </Link>
            <Link href="/signup">
              <Button>Criar conta grátis</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-6 py-20 text-center">
          <h1 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
            Agendamentos online para o seu negócio de serviços
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-zinc-600">
            Barbearias, salões, manicures, estética, tatuagem, massagem,
            personal trainers e mais. Configure sua agenda em minutos e receba
            um link só seu.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/signup">
              <Button className="h-12 px-6 text-base">Começar agora</Button>
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-20">
          <div className="grid gap-6 sm:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-zinc-200 p-6"
              >
                <h3 className="font-medium text-zinc-900">{feature.title}</h3>
                <p className="mt-2 text-sm text-zinc-600">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-zinc-200 bg-zinc-50 py-16">
          <div className="mx-auto max-w-5xl px-6 text-center">
            <h2 className="text-2xl font-semibold text-zinc-900">
              Feito para o seu segmento
            </h2>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {Object.values(segmentLabels).map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm text-zinc-700"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 py-6">
        <p className="text-center text-sm text-zinc-500">
          © {new Date().getFullYear()} Aureon Agenda
        </p>
      </footer>
    </div>
  );
}
