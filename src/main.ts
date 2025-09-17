import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as dotenv from 'dotenv';
dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('Attendance System API')
    .setDescription('Admin/User dashboards, attendance, leaves, profile upload')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server running: https://attendance-backend-pz8g.onrender.com:${port}`);
  console.log(`Swagger docs: https://attendance-backend-pz8g.onrender.com:${port}/api`);
}
bootstrap();
