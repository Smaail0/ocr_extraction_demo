import { bootstrapApplication }     from '@angular/platform-browser';
import { importProvidersFrom }      from '@angular/core';
import { provideRouter }            from '@angular/router';
import { provideHttpClient,
         withInterceptorsFromDi }   from '@angular/common/http';

import { AppComponent }  from './app/app.component';
import { appConfig }     from './app/app.config';

bootstrapApplication(AppComponent, {
  ...appConfig,
  providers: [
    // preserve your existing router / other providers
    ...(appConfig.providers ?? []),
    // replace HttpClientModule:
    provideHttpClient(withInterceptorsFromDi())
  ]
})
.catch(err => console.error(err));
