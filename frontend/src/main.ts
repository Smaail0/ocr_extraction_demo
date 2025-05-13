import { bootstrapApplication }     from '@angular/platform-browser';
import { importProvidersFrom, LOCALE_ID }      from '@angular/core';
import { provideRouter }            from '@angular/router';
import { provideHttpClient,
         withInterceptorsFromDi }   from '@angular/common/http';

import { appConfig }     from './app/app.config';

import { BrowserModule }       from '@angular/platform-browser';
import { HttpClientModule }    from '@angular/common/http';
import { FormsModule }         from '@angular/forms';

import { AppComponent }        from './app/app.component';
import { routes }              from './app/app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';

registerLocaleData(localeFr);

bootstrapApplication(AppComponent, {
  
  ...appConfig,
  providers: [
    // preserve your existing router / other providers
    ...(appConfig.providers ?? []),
    // replace HttpClientModule:
    provideHttpClient(withInterceptorsFromDi()),
    importProvidersFrom(
      BrowserModule,
      HttpClientModule,
      FormsModule
    ),
    provideRouter(routes), provideAnimationsAsync(),
    { provide: LOCALE_ID, useValue: 'fr' }
  ]
})
.catch(err => console.error(err));
