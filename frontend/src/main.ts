import { bootstrapApplication }     from '@angular/platform-browser';
import { importProvidersFrom, LOCALE_ID }      from '@angular/core';
import { provideRouter }            from '@angular/router';
import { provideHttpClient,
         withInterceptorsFromDi }   from '@angular/common/http';
import { provideAnimationsAsync }  from '@angular/platform-browser/animations/async';

import { appConfig }               from './app/app.config';
import { AppComponent }            from './app/app.component';
import { routes }                  from './app/app.routes';

import { BrowserModule }           from '@angular/platform-browser';
import { HttpClientModule }        from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { TranslateModule,
         TranslateLoader }         from '@ngx-translate/core';
import { TranslateHttpLoader }     from '@ngx-translate/http-loader';
import { HttpClient }              from '@angular/common/http';

import { MatTableModule }          from '@angular/material/table';
import { MatIconModule }           from '@angular/material/icon';
import { MatButtonModule }         from '@angular/material/button';
import { MatTooltipModule }        from '@angular/material/tooltip';
import { MatDialogModule }         from '@angular/material/dialog';
import { UserService } from './app/services/user.service';
import { AdminPanelComponent } from './app/components/admin-panel/admin-panel.component';
import { AuthInterceptor } from './app/interceptors/auth.interceptor';
import { HTTP_INTERCEPTORS } from '@angular/common/http';

import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';

registerLocaleData(localeFr);

export function HttpLoaderFactory(http: HttpClient) {
  return new TranslateHttpLoader(http, '/assets/i18n/', '.json');
}

bootstrapApplication(AppComponent, {
  ...appConfig,
  providers: [
    {provide: LOCALE_ID, useValue: 'fr-FR'} ,
    provideRouter(routes),
    UserService,
    ...(appConfig.providers ?? []),
    provideHttpClient(withInterceptorsFromDi()),
    importProvidersFrom(
      BrowserModule,
      HttpClientModule,
      FormsModule,
      ReactiveFormsModule,

      // Material modules
      MatTableModule,
      MatIconModule,
      MatButtonModule,
      MatTooltipModule,
      MatDialogModule,

      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useFactory: HttpLoaderFactory,
          deps: [HttpClient]
        }
      })
    ),
    provideRouter(routes),
    provideAnimationsAsync(),
    {
      provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true
    }
  ]
})
.catch(err => console.error(err));
