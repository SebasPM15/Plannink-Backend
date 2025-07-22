import {Injectable} from '@angular/core';
import {
    HttpRequest,
    HttpHandler,
    HttpEvent,
    HttpInterceptor, HttpResponse, HTTP_INTERCEPTORS
} from '@angular/common/http';
import {from, Observable, of, switchMap} from 'rxjs';
import {catchError, tap} from "rxjs/operators";
import {EncryptDecryptService} from "../_service/encryptdecryptservice.service";

@Injectable()
export class DecryptionInterceptor implements HttpInterceptor {

    constructor(private readonly encryptService: EncryptDecryptService) {
    }

    intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        return next.handle(request).pipe(
            switchMap(event => {
                if (event instanceof HttpResponse) {
                    if (event.headers.has('encription')) {
                        const decryptedResponse = this.encryptService.decryptUsingAES256(event.body);
                        const modifiedEvent = event.clone({ body: decryptedResponse });
                        return of(modifiedEvent);
                    }
                }
                return of(event);
            }),
            catchError(error => {
                // Handle error if necessary
                throw error;
            })
        );
    }
}

export const decryptionInterceptor = [{provide: HTTP_INTERCEPTORS, useClass: DecryptionInterceptor, multi: true}];

