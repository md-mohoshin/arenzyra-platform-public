import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  app.enableCors();
  app.setGlobalPrefix("api");

  const port = parseInt(process.env.PORT ?? "4000", 10);
  await app.listen(port);
  console.log(`Match State Service listening on http://127.0.0.1:${port}`);
  console.log(`WebSocket namespace: ws://127.0.0.1:${port}/ws`);
}

bootstrap();
