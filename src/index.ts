import { runCli } from "./adapters/cli/main";

async function bootstrap() {
  await runCli();
}

bootstrap().catch((err) => {
  console.error("💥 Error fatal:", err);
  process.exit(1);
});