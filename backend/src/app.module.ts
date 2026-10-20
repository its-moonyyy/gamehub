import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { FriendsModule } from './friends/friends.module.js';
import { GamesModule } from './games/games.module.js';
import { TablesModule } from './tables/tables.module.js';
import { TasksModule } from './tasks/tasks.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: Number.parseInt(config.get<string>('DB_PORT', '5433'), 10),
        username: config.get<string>('DB_USERNAME', 'app'),
        password: config.get<string>('DB_PASSWORD', 'app_password'),
        database: config.get<string>('DB_NAME', 'app_db'),
        autoLoadEntities: true,
        // Dev only: creates/updates tables automatically from entities.
        // Use migrations for a real production setup.
        synchronize: true,
      }),
    }),
    AuthModule,
    FriendsModule,
    GamesModule,
    TablesModule,
    TasksModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
