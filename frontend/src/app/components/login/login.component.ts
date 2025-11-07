import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent implements OnInit, OnDestroy {
  isProcessing = false;
  errorMessage: string | null = null;
  email: string = '';
  password: string = '';
  private storageListener?: (event: StorageEvent) => void;
  private tokenCheckInterval?: any;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private authService: AuthService
  ) {}

  ngOnInit() {
    // Capturar los tokens si volvemos del callback de Spotify
    this.route.queryParams.subscribe(params => {
      const accessToken = params['access_token'];
      const refreshToken = params['refresh_token'];
      const error = params['error'];
      const shouldClose = params['close'] === 'true';
      const tokenExpired = params['token_expired'];

      if (error) {
        // Mostrar mensaje de error más específico según el tipo de error
        let errorMsg = 'Error en la autenticación. Por favor, intenta de nuevo.';
        const errorDetails = params['details'];
        
        if (error === 'no_code') {
          errorMsg = 'No se recibió el código de autorización de Spotify. Por favor, intenta de nuevo.';
        } else if (error === 'auth_failed') {
          errorMsg = 'Error al autenticarse con Spotify. Por favor, verifica tus credenciales e intenta de nuevo.';
          if (errorDetails) {
            console.error('Detalles del error:', decodeURIComponent(errorDetails));
          }
        } else if (error === 'spotify_error') {
          errorMsg = 'Spotify rechazó la solicitud de autorización. Por favor, intenta de nuevo.';
          if (errorDetails) {
            console.error('Error de Spotify:', decodeURIComponent(errorDetails));
          }
        }
        
        this.errorMessage = errorMsg;
        console.error('Error en autenticación:', error, errorDetails ? `Detalles: ${decodeURIComponent(errorDetails)}` : '');
        this.isProcessing = false;
        return;
      }

      if (tokenExpired) {
        this.errorMessage = 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.';
        return;
      }

      if (accessToken && refreshToken) {
        // Guardar tokens inmediatamente
        this.authService.saveTokens(accessToken, refreshToken, params['user_id']);
        
        // Si viene de una ventana popup (close=true), cerrar la ventana después de guardar
        if (shouldClose) {
          // Pequeño delay para asegurar que los tokens se guarden
          setTimeout(() => {
            window.close();
          }, 100);
          return;
        }
        
        // Si es la misma pestaña, procesar normalmente
        this.processTokens(accessToken, refreshToken, params['user_id']);
      }
    });

    // Escuchar cambios en localStorage para detectar tokens guardados desde otra pestaña
    this.setupStorageListener();
    
    // También hacer polling periódico para detectar tokens (fallback)
    this.setupTokenPolling();
  }

  ngOnDestroy() {
    // Limpiar listeners
    if (this.storageListener) {
      window.removeEventListener('storage', this.storageListener);
    }
    if (this.tokenCheckInterval) {
      clearInterval(this.tokenCheckInterval);
    }
  }

  private setupStorageListener() {
    // Escuchar eventos de almacenamiento (cuando otra pestaña guarda tokens)
    this.storageListener = (event: StorageEvent) => {
      if (event.key === 'spotify_access_token' && event.newValue) {
        // Verificar que no estemos ya procesando
        if (!this.isProcessing && !this.authService.isAuthenticated()) {
          const refreshToken = localStorage.getItem('spotify_refresh_token');
          const userId = localStorage.getItem('user_id');
          
          if (refreshToken) {
            this.processTokens(event.newValue, refreshToken, userId || undefined);
          }
        }
      }
    };
    
    window.addEventListener('storage', this.storageListener);
  }

  private setupTokenPolling() {
    // Polling cada 500ms para detectar tokens guardados desde otra pestaña
    // (necesario porque el evento 'storage' solo se dispara entre pestañas diferentes)
    this.tokenCheckInterval = setInterval(() => {
      // Solo verificar si no estamos procesando y no estamos autenticados
      if (!this.isProcessing && !this.authService.isAuthenticated()) {
        const accessToken = this.authService.getAccessToken();
        const refreshToken = localStorage.getItem('spotify_refresh_token');
        const userId = localStorage.getItem('user_id');
        
        // Si hay tokens pero no estamos autenticados, procesarlos
        if (accessToken && refreshToken) {
          this.processTokens(accessToken, refreshToken, userId || undefined);
        }
      }
    }, 500);
  }

  private processTokens(accessToken: string, refreshToken: string, userId?: string) {
    this.isProcessing = true;
    
    // Guardar tokens en localStorage (si no están ya guardados)
    this.authService.saveTokens(accessToken, refreshToken, userId);
    
    // Redirigir inmediatamente al feed después de guardar los tokens
    this.router.navigate(['/app/feed'], { replaceUrl: true });
    
    // Obtener el perfil en segundo plano para guardar el email (opcional)
    this.authService.getProfile().subscribe({
      next: (profile: any) => {
        // Guardar email en localStorage si está disponible
        if (profile.email) {
          localStorage.setItem('user_email', profile.email);
        }
      },
      error: (error) => {
        // No es crítico si falla, el usuario ya está autenticado
        console.log('No se pudo obtener el perfil inmediatamente, se intentará más tarde');
      }
    });
  }

  onLoginSubmit() {
    if (!this.email || !this.password) {
      this.errorMessage = 'Por favor, completa todos los campos';
      return;
    }

    this.isProcessing = true;
    this.errorMessage = null;

    this.authService.loginWithEmailPassword(this.email, this.password).subscribe({
      next: (response) => {
        // Guardar tokens en localStorage
        this.authService.saveTokens(
          response.access_token,
          response.refresh_token,
          response.user_id
        );
        
        // Guardar email en localStorage para verificación posterior
        if (this.email) {
          localStorage.setItem('user_email', this.email);
        }
        
        // Redirigir al feed
        this.router.navigate(['/app/feed']);
      },
      error: (error) => {
        this.isProcessing = false;
        this.errorMessage = error.error?.error || 'Error al iniciar sesión. Por favor, intenta de nuevo.';
        console.error('Error en login:', error);
      }
    });
  }

  onSpotifyLogin() {
    console.log('🎵 Iniciando login con Spotify...');
    this.isProcessing = true;
    this.errorMessage = null;
    
    // Redirigir directamente a la URL de login de Spotify en el backend
    this.authService.login();
  }

  // Manejo de eventos de mouse para el botón
  onButtonMouseDown(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (target && !this.isProcessing) {
      target.style.transform = 'translateY(1px)';
    }
  }

  onButtonMouseUp(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (target) {
      target.style.transform = 'translateY(0)';
    }
  }

  onInputFocus(event: Event): void {
    const target = event.target as HTMLElement;
    if (target) {
      target.style.borderColor = '#1db954';
    }
  }

  onInputBlur(event: Event): void {
    const target = event.target as HTMLElement;
    if (target) {
      target.style.borderColor = 'rgba(15,23,42,0.1)';
    }
  }
}
