import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './profile.component.html'
})
export class ProfileComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('reviewsContainer', { static: false }) reviewsContainer!: ElementRef;
  @ViewChild('galleryContainer', { static: false }) galleryContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('latestReviewsContainer', { static: false }) latestReviewsContainer!: ElementRef;
  
  profile: any = {
    display_name: 'saragnzlz',
    id: 'saragnzlz',
    images: [{
      url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=faces'
    }]
  };
  reviews: any[] = [];
  latestReviews: any[] = [];
  allReviews: any[] = [];
  displayedCircleReviews: any[] = []; // Elementos repetidos para el círculo
  error: string | null = null;
  activeTab: 'diario' | 'likes' = 'diario';
  private readonly API_URL = 'http://127.0.0.1:3000';
  currentScrollPosition: number = 0;
  
  // Propiedades para controlar la visibilidad de las flechas de últimas reseñas
  canScrollLatestLeftValue: boolean = false;
  canScrollLatestRightValue: boolean = false;
  
  // ----- CÍRCULO / PHYSICS (G3) -----
  circleRotation: number = 0; // Ángulo de desplazamiento de las imágenes en la circunferencia (en grados)
  circleContainerWidth: number = 1400; // Ancho del contenedor del círculo (calculado en ngOnInit)
  
  // Pointer events para arrastre
  private isPointerDown: boolean = false;
  private lastPointerX: number = 0;
  private lastTimestamp: number = 0;
  private angularVelocity: number = 0; // grados / ms
  private rafId: number | null = null;
  private inertiaRafId: number | null = null;
  private autoRotateRafId: number | null = null;
  private constantRotationRafId: number | null = null; // RAF para rotación constante después del scroll
  private readonly autoRotateSpeed: number = 0.0025; // grados/ms (suave auto-rotación)
  private readonly friction: number = 0.997; // factor de fricción por frame para inertia
  private readonly minVelocity: number = 0.0004; // umbral para detener inertia
  private readonly constantRotationSpeed: number = 0.05; // grados/ms - velocidad constante después del scroll
  private constantRotationDuration: number = 1500; // ms - duración de la rotación constante
  private constantRotationStartTime: number = 0; // tiempo de inicio de la rotación constante
  private pointerId: number | null = null; // para multitouch/pen

  // Stats (placeholder values - should be fetched from API)
  followers: number = 1347;
  following: number = 2485;
  records: number = 56;
  bio: string = 'Música que me gusta y tal';

  // Ángulos para la galería dispersa (scattered gallery)
  private scatteredAngles = [-8, 5, -3, 7, -6, 4, -5, 6];

  constructor(
    private authService: AuthService,
    private route: ActivatedRoute,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private ngZone: NgZone
  ) {}

  ngOnInit() {
    // Ajuste inicial del contenedor circular responsive
    this.calculateCircleContainerWidth();
    
    // Cargar datos de ejemplo para pruebas
    this.loadMockData();
    
    // Iniciar auto-rotación
    this.startAutoRotate();
    
    this.route.queryParams.subscribe((params: any) => {
      if (params['access_token'] && params['refresh_token']) {
        this.authService.saveTokens(
          params['access_token'], 
          params['refresh_token'],
          params['user_id']
        );
        window.history.replaceState({}, '', '/');
        // Cargar el perfil para obtener el email y guardarlo
        // Limpiar los query params manteniendo la ruta actual
        this.router.navigate([], { 
          relativeTo: this.route, 
          queryParams: {}, 
          replaceUrl: true 
        });
        this.loadProfile();
      } else if (params['error']) {
        this.error = 'Error en la autenticación';
      } else {
        // Si no hay token, usar datos de ejemplo
        if (!this.authService.getAccessToken()) {
          this.loadMockData();
        } else {
          this.loadProfile();
        }
      }
    });
  }

  ngAfterViewInit() {
    // Aseguramos que el cálculo se haga después de layout
    this.calculateCircleContainerWidth();
    window.addEventListener('resize', () => this.calculateCircleContainerWidth());
    
    // Configurar el listener de scroll después de que la vista esté inicializada
    if (this.reviewsContainer) {
      this.reviewsContainer.nativeElement.addEventListener('scroll', () => {
        this.cdr.detectChanges();
      });
    }
    if (this.latestReviewsContainer) {
      this.latestReviewsContainer.nativeElement.addEventListener('scroll', () => {
        this.updateLatestScrollButtons();
        this.cdr.detectChanges();
      });
      // Inicializar los valores después de que la vista esté lista
      setTimeout(() => {
        this.updateLatestScrollButtons();
        this.cdr.detectChanges();
      }, 0);
    }
  }

  loadMockData() {
    // Datos de perfil de ejemplo
    this.profile = {
      display_name: 'saragnzlz',
      id: 'saragnzlz',
      images: [{
        url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=faces'
      }],
      bio: 'Música que me gusta y tal'
    };

    // Estadísticas de ejemplo (como en la imagen)
    this.followers = 1347;
    this.following = 2485;
    this.records = 56; // Como en la imagen
    this.bio = 'Música que me gusta y tal';
    
    // Generar reseñas de ejemplo
    this.reviews = Array.from({ length: 9 }).map((_, i) => ({
      spotify_id: `r${i}`,
      album_image: `https://picsum.photos/seed/album${i}/400`,
      title: `Album ${i}`
    }));
    
    this.latestReviews = this.reviews.slice(0, 3);

    // Mantener allReviews para compatibilidad
    this.allReviews = this.reviews;
    this.updateDisplayedReviews();
  }

  login() {
    // Si ya hay token guardado, intentar cargar el perfil
    if (this.authService.getAccessToken()) {
      this.loadProfile();
      return;
    }
    // Si no hay token, redirigir directamente a Spotify
    this.authService.login();
  }

  loadProfile() {
    const token = this.authService.getAccessToken();
    if (!token) {
      this.profile = null;
      // Si no hay token, verificar si está registrado en la BD antes de redirigir
      this.checkRegistrationBeforeRedirect();
      return;
    }

    // Verificar si el token es de Spotify o de email/password
    const isSpotifyToken = !token.startsWith('token_');
    
    this.authService.getProfile().subscribe({
      next: (data: any) => {
        this.profile = data;
        this.error = null;
        // Guardar email en localStorage si está disponible (para verificación posterior)
        if (data.email) {
          localStorage.setItem('user_email', data.email);
        }
        this.loadReviews();
        this.updateStats();
      },
      error: (error) => {
        // Si falla y es un token de Spotify, verificar si está registrado en la BD
        if (isSpotifyToken) {
          this.checkRegistrationBeforeRedirect();
        } else {
          // Si es un token de email/password y falla, usar datos mock
          this.profile = null;
          this.loadMockData();
        }
      }
    });
  }

  checkRegistrationBeforeRedirect() {
    // Verificar si el usuario está registrado en la BD antes de redirigir a Spotify
    const email = localStorage.getItem('user_email') || undefined;
    
    // Solo verificar con email, no con token de Spotify (para evitar bucles)
    this.authService.checkUserRegistration(email, undefined).subscribe({
      next: (response) => {
        if (response.registered) {
          // Usuario está registrado en la BD, no redirigir a Spotify
          // Usar datos mock o mostrar mensaje
          this.loadMockData();
        } else {
          // Usuario no está registrado, redirigir directamente a Spotify
          this.authService.login();
        }
      },
      error: (error) => {
        console.error('Error al verificar registro:', error);
        // En caso de error, usar datos mock en lugar de redirigir
        this.loadMockData();
      }
    });
  }

  loadReviews() {
    const userId = this.authService.getUserId();
    if (!userId) return;

    const token = this.authService.getAccessToken();
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`
    });

    this.http.get<any[]>(`${this.API_URL}/api/reviews/user/${userId}`, { headers }).subscribe({
      next: (reviews: any[]) => {
        this.allReviews = reviews;
        this.records = reviews.length;
        // Todas las reseñas para el scroll horizontal
        this.latestReviews = reviews;
        this.updateDisplayedReviews();
      },
      error: (err: any) => {
        console.error('Error loading reviews:', err);
      }
    });
  }

  updateDisplayedReviews() {
    if (this.activeTab === 'diario') {
      this.reviews = this.allReviews;
    } else {
      // For "Me gusta" tab, filter liked reviews (placeholder)
      this.reviews = this.allReviews; // TODO: Implement likes functionality
    }
    // Generar lista de elementos repetidos para el círculo
    this.generateDisplayedCircleReviews();
  }

  // Generar lista de elementos repetidos para llenar el círculo visible
  generateDisplayedCircleReviews(): void {
    if (this.reviews.length === 0) {
      this.displayedCircleReviews = [];
      return;
    }
    
    // Calcular cuántos elementos necesitamos para cubrir el arco visible
    // Necesitamos cubrir 180 grados (mitad superior) + elementos extra para rotación
    const constantAngleStep = 8; // grados de separación constante entre elementos (reducido de 12 a 8)
    const visibleArc = 180; // grados del arco visible
    const elementsNeeded = Math.ceil(visibleArc / constantAngleStep) + 2; // +2 para tener elementos extra
    
    // Generar elementos adicionales para cubrir rotaciones hacia la izquierda
    // Necesitamos elementos que cubran desde -90 hacia atrás (hasta -270 aproximadamente)
    // Esto nos permite rotar hacia la izquierda sin que falten elementos
    const extraElementsForLeftRotation = Math.ceil(180 / constantAngleStep); // Elementos adicionales para rotación izquierda
    
    // Total de elementos: los necesarios para el arco visible + extras para rotación
    const totalElementsNeeded = elementsNeeded + extraElementsForLeftRotation;
    
    // Asegurar que siempre haya suficientes elementos, incluso si hay pocos elementos originales
    const totalOriginal = this.reviews.length;
    
    // Repetir los elementos tantas veces como sea necesario para llenar todos los espacios
    // Usar módulo para volver al primer elemento cuando se llegue al último
    this.displayedCircleReviews = [];
    for (let i = 0; i < totalElementsNeeded; i++) {
      const originalIndex = i % totalOriginal; // Usar módulo para volver al primero cuando se llegue al último
      // Crear una copia del elemento con el índice original para referencia
      const reviewCopy = { ...this.reviews[originalIndex], originalIndex: originalIndex, displayIndex: i };
      this.displayedCircleReviews.push(reviewCopy);
    }
  }

  updateStats() {
    if (this.profile?.followers?.total) {
      this.followers = this.profile.followers.total;
    }
    // Following and bio would need to be fetched from your user API
  }

  setActiveTab(tab: 'diario' | 'likes'): void {
    this.activeTab = tab;
    this.updateDisplayedReviews();
  }

  getCardRotation(index: number): string {
    // Rotate cards slightly for visual interest
    const rotations = [-2, 0, 2, 0, -1, 1, -2, 0, 2];
    const rotation = rotations[index % rotations.length];
    return `rotate(${rotation}deg)`;
  }

  // ---------------------------------------------------------------------------
  // 📀 SCATTERED GALLERY: Ángulos variables por índice
  // Devuelve -8, 5, -3, 7, -6, 4, -5, 6, ... de forma cíclica
  // ---------------------------------------------------------------------------
  getScatteredAngle(i: number): number {
    return this.scatteredAngles[i % this.scatteredAngles.length];
  }

  // ---------------------------------------------------------------------------
  // 🔄 CÍRCULO ROTATORIO: Galería principal
  // ---------------------------------------------------------------------------
  
  // -------------------------
  // CALCULO DE TAMAÑO CIRCULAR (responsive)
  // -------------------------
  calculateCircleContainerWidth(): void {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 420;
    // Queremos un círculo grande que nos permita tener la mitad superior visible.
    // Lo hacemos dependiente del viewport para que sea responsivo (M3)
    // Aumentado para usar más ancho de la pantalla (multiplicado por 3.5 para usar más espacio a los lados)
    const base = Math.max(1200, Math.round(vw * 3.5));
    this.circleContainerWidth = base; // Más amplio para usar más espacio de la pantalla a los lados
    this.cdr.detectChanges();
  }

  getCircleContainerWidth(): number {
    return this.circleContainerWidth;
  }
  
  // -------------------------
  // POSICIONAMIENTO DE TARJETAS
  // -------------------------
  getCircleCardTransform(index: number): string {
    // Espacio angular constante entre elementos (uno seguido de otro)
    const constantAngleStep = 8; // grados de separación constante entre elementos (reducido de 12 a 8)
    
    // Calcular el ángulo base considerando elementos adicionales para rotación izquierda
    // Los primeros elementos están en ángulos negativos (antes de -90) para permitir rotación izquierda
    const extraElementsForLeftRotation = Math.ceil(180 / constantAngleStep);
    // Ajustar el índice para que los elementos empiecen desde un ángulo negativo
    const adjustedIndex = index - extraElementsForLeftRotation;
    
    // baseAngle: distribuye las tarjetas uno seguido de otro desde la parte superior
    const baseAngle = (-90 + adjustedIndex * constantAngleStep) + this.circleRotation;
    const rad = baseAngle * (Math.PI / 180);

    // Radio aumentado del círculo (sin cambiar)
    const radius = (this.circleContainerWidth / 2) - 200; // radio aumentado para pantallas de escritorio
    // Parallax depth: variamos la "altura" según el ángulo (las más arriba se verán más cerca)
    const depthFactor = 1 + Math.cos(rad) * 0.08; // pequeñas diferencias de escala
    const x = (this.circleContainerWidth / 2) + radius * Math.cos(rad) - 80; // -half card (ajustado para tarjetas más grandes)
    const y = (this.circleContainerWidth / 2) + radius * Math.sin(rad) - 80;

    // Calcular el índice original del elemento usando módulo para hacer el círculo infinito
    const totalOriginal = this.reviews.length || 1;
    const originalIndex = index % totalOriginal;
    // Rotación para que sigan un poco la curva + rotación artística aleatoria
    const followRotation = baseAngle + (originalIndex % 3 - 1) * 3;

    // Ajuste final: translate + rotate + scale para dar parallax
    const scale = 0.92 * depthFactor;
    return `translate(${x}px, ${y}px) rotate(${followRotation}deg) scale(${scale})`;
  }
  
  // z-index para dar profundidad (las más "arriba" y cercanas ganan z)
  getCircleCardZIndex(index: number): number {
    // Espacio angular constante entre elementos (uno seguido de otro)
    const constantAngleStep = 8; // grados de separación constante entre elementos (reducido de 12 a 8)
    
    // Calcular el ángulo base considerando elementos adicionales para rotación izquierda
    const extraElementsForLeftRotation = Math.ceil(180 / constantAngleStep);
    // Ajustar el índice para que los elementos empiecen desde un ángulo negativo
    const adjustedIndex = index - extraElementsForLeftRotation;
    
    const baseAngle = (-90 + adjustedIndex * constantAngleStep) + this.circleRotation;
    const rad = baseAngle * (Math.PI / 180);
    // y más negativo => más arriba => zIndex mayor
    const radius = (this.circleContainerWidth / 2) - 200; // radio aumentado para pantallas de escritorio
    const y = radius * Math.sin(rad);
    // Convertimos a un valor z-index decente
    return Math.round(2000 - y);
  }
  
  // -------------------------
  // ROTATE CONTROLS (flechas)
  // -------------------------
  rotateCircleLeft(): void {
    const constantAngleStep = 8; // grados de separación constante entre elementos (reducido de 12 a 8)
    
    // Calcular qué elemento está actualmente en la parte superior (ángulo -90)
    // baseAngle = (-90 + adjustedIndex * constantAngleStep) + circleRotation = -90
    // Entonces: adjustedIndex * constantAngleStep + circleRotation = 0
    // adjustedIndex = -circleRotation / constantAngleStep
    const currentAdjustedIndex = -this.circleRotation / constantAngleStep;
    
    // Calcular el índice del elemento de la izquierda (anterior)
    const leftAdjustedIndex = currentAdjustedIndex - 1;
    
    // Calcular el ángulo objetivo para posicionar el elemento de la izquierda en la parte superior
    // Queremos que: (-90 + leftAdjustedIndex * constantAngleStep) + targetRotation = -90
    // Entonces: targetRotation = -leftAdjustedIndex * constantAngleStep
    const targetRotation = -leftAdjustedIndex * constantAngleStep;
    
    // Detener auto-rotación y rotación constante previa
    this.stopAutoRotate();
    this.stopConstantRotation();
    this.stopInertia();
    
    // Rotar hasta el elemento de la izquierda con animación suave
    this.rotateToTarget(targetRotation, () => {
      // Una vez posicionado, aplicar inercia hacia la derecha (sentido contrario al botón)
      // Presionar izquierda → inercia hacia la derecha
      // Usar la misma velocidad que la auto-rotación inicial
      this.angularVelocity = this.autoRotateSpeed; // positiva = hacia la derecha, misma velocidad inicial
      this.applyInertia(() => {
        // Después de la inercia, continuar girando hacia la derecha (mismo sentido de la inercia)
        this.startAutoRotateWithDirection(this.autoRotateSpeed);
      });
    });
  }

  rotateCircleRight(): void {
    const constantAngleStep = 8; // grados de separación constante entre elementos (reducido de 12 a 8)
    
    // Calcular qué elemento está actualmente en la parte superior (ángulo -90)
    const currentAdjustedIndex = -this.circleRotation / constantAngleStep;
    
    // Calcular el índice del elemento de la derecha (siguiente)
    const rightAdjustedIndex = currentAdjustedIndex + 1;
    
    // Calcular el ángulo objetivo para posicionar el elemento de la derecha en la parte superior
    const targetRotation = -rightAdjustedIndex * constantAngleStep;
    
    // Detener auto-rotación y rotación constante previa
    this.stopAutoRotate();
    this.stopConstantRotation();
    this.stopInertia();
    
    // Rotar hasta el elemento de la derecha con animación suave
    this.rotateToTarget(targetRotation, () => {
      // Una vez posicionado, aplicar inercia hacia la izquierda (sentido contrario al botón)
      // Presionar derecha → inercia hacia la izquierda
      // Usar la misma velocidad que la auto-rotación inicial
      this.angularVelocity = -this.autoRotateSpeed; // negativa = hacia la izquierda, misma velocidad inicial
      this.applyInertia(() => {
        // Después de la inercia, continuar girando hacia la izquierda (mismo sentido de la inercia)
        this.startAutoRotateWithDirection(-this.autoRotateSpeed);
      });
    });
  }

  // Rotar hasta un ángulo objetivo con animación suave
  rotateToTarget(targetRotation: number, onComplete?: () => void): void {
    const startRotation = this.circleRotation;
    
    // Normalizar ambos ángulos para calcular la diferencia correcta
    const normalizedStart = ((startRotation % 360) + 360) % 360;
    const normalizedTarget = ((targetRotation % 360) + 360) % 360;
    
    // Calcular la diferencia de rotación y tomar el camino más corto
    let rotationDiff = normalizedTarget - normalizedStart;
    if (rotationDiff > 180) rotationDiff -= 360;
    if (rotationDiff < -180) rotationDiff += 360;
    
    const duration = 300; // ms - duración de la animación
    const startTime = performance.now();
    
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Usar easing suave (ease-out)
      const eased = 1 - Math.pow(1 - progress, 3);
      
      // Calcular rotación actual desde la rotación inicial normalizada
      let currentRotation = normalizedStart + rotationDiff * eased;
      this.circleRotation = currentRotation;
      this.normalizeRotation();
      this.cdr.detectChanges();
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Asegurar que llegamos exactamente al objetivo normalizado
        this.circleRotation = normalizedTarget;
        this.normalizeRotation();
        this.cdr.detectChanges();
        if (onComplete) {
          onComplete();
        }
      }
    };
    
    requestAnimationFrame(animate);
  }

  normalizeRotation(): void {
    this.circleRotation = ((this.circleRotation % 360) + 360) % 360;
  }
  
  // -------------------------
  // G3: POINTER (drag) + INERCIA + AUTOMATIC ROTATION
  // -------------------------
  onCirclePointerDown(event: PointerEvent): void {
    // Capturamos el pointer para que podamos seguir eventos fuera del elemento
    const el = this.galleryContainer?.nativeElement;
    if (!el) return;
    el.setPointerCapture?.(event.pointerId);
    this.pointerId = event.pointerId;
    this.isPointerDown = true;
    this.lastPointerX = event.clientX;
    this.lastTimestamp = performance.now();
    // parar auto-rotación, rotación constante y cualquier inertia actual
    this.stopAutoRotate();
    this.stopConstantRotation();
    this.stopInertia();
  }

  onCirclePointerMove(event: PointerEvent): void {
    if (!this.isPointerDown) return;
    // cálculo de delta y velocidad angular (deg / ms)
    const now = performance.now();
    const dx = event.clientX - this.lastPointerX;
    const dt = Math.max(1, now - this.lastTimestamp); // ms
    // Sensibilidad: convertir px en grados. Ajusta el divisor para mayor/menor sensibilidad.
    const pxToDeg = 0.3; // 1px -> 0.3 degrees (ajustable)
    const deltaDeg = dx * pxToDeg; // Rotación durante el arrastre (sigue la dirección del scroll)
    
    // Calcular la velocidad angular para la inercia
    // La inercia va en sentido contrario al scroll
    // Si arrastras hacia la izquierda (dx negativo), la inercia va hacia la derecha (velocidad positiva)
    // Si arrastras hacia la derecha (dx positivo), la inercia va hacia la izquierda (velocidad negativa)
    const v = -(deltaDeg / dt); // deg / ms (invertido para que la inercia vaya en sentido contrario)
    this.angularVelocity = v;
    
    // Aplicar la rotación durante el arrastre (sigue la dirección del scroll)
    this.circleRotation += deltaDeg;
    this.normalizeRotation();
    this.lastPointerX = event.clientX;
    this.lastTimestamp = now;
    this.cdr.detectChanges();
  }

  onCirclePointerUp(event: PointerEvent): void {
    if (!this.isPointerDown) return;
    this.isPointerDown = false;
    const el = this.galleryContainer?.nativeElement;
    if (el && this.pointerId !== null) {
      try { el.releasePointerCapture?.(this.pointerId); } catch(e) {}
      this.pointerId = null;
    }
    // Guardar la dirección de la inercia para continuar después
    // La angularVelocity ya está invertida, así que si es positiva, la inercia va hacia la derecha
    const inertiaDirection = this.angularVelocity >= 0 ? 1 : -1;
    
    // Al soltar, aplicamos inercia según la última angularVelocity
    this.applyInertia(() => {
      // Después de que la inercia termine, continuar rotando en el mismo sentido de la inercia
      this.startAutoRotateWithDirection(this.autoRotateSpeed * inertiaDirection);
    });
  }

  // -------------------------
  // INERCIA (momentum) usando requestAnimationFrame
  // -------------------------
  applyInertia(onComplete?: () => void): void {
    // Cancelar cualquier inertia previa
    this.stopInertia();

    const step = (time: number) => {
      // Aplicamos la velocidad actual
      // speed (deg / ms) -> multiplicar por dt para obtener delta
      let lastTime = performance.now();
      const frame = (t: number) => {
        const now = performance.now();
        const dt = Math.max(0, now - lastTime); // ms
        lastTime = now;

        // delta angle
        const delta = this.angularVelocity * dt;
        this.circleRotation += delta;
        this.normalizeRotation();

        // aplicar fricción
        this.angularVelocity *= Math.pow(this.friction, dt / 16.67); // adaptación al frame tiempo (60fps ref)

        // si la velocidad cae por debajo del umbral, detener
        if (Math.abs(this.angularVelocity) < this.minVelocity) {
          this.angularVelocity = 0;
          this.stopInertia();
          // Ejecutar callback si existe
          if (onComplete) {
            onComplete();
          }
          return;
        }

        this.cdr.detectChanges();
        this.inertiaRafId = requestAnimationFrame(frame);
      };
      this.inertiaRafId = requestAnimationFrame(frame);
    };

    // start
    step(performance.now());
  }

  stopInertia(): void {
    if (this.inertiaRafId) {
      cancelAnimationFrame(this.inertiaRafId);
      this.inertiaRafId = null;
    }
  }

  // -------------------------
  // AUTO-ROTATION (suave) - corre en background cuando no se interactúa
  // -------------------------
  startAutoRotate(): void {
    // Evitar múltiples rafs
    if (this.autoRotateRafId) return;
    let last = performance.now();
    const loop = (t: number) => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      // Solo aplica si no hay velocidad humana y no está arrastrando
      if (!this.isPointerDown && Math.abs(this.angularVelocity) < 0.0005) {
        this.circleRotation += this.autoRotateSpeed * dt; // degrees
        this.normalizeRotation();
        this.cdr.detectChanges();
      }
      this.autoRotateRafId = requestAnimationFrame(loop);
    };
    this.autoRotateRafId = requestAnimationFrame(loop);
  }

  // Auto-rotación con dirección específica (después del scroll)
  startAutoRotateWithDirection(speed: number): void {
    // Detener cualquier auto-rotación previa
    this.stopAutoRotate();
    
    // Evitar múltiples rafs
    if (this.autoRotateRafId) return;
    let last = performance.now();
    const loop = (t: number) => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      // Solo aplica si no está arrastrando
      if (!this.isPointerDown) {
        // Rotar con la velocidad especificada (puede ser positiva o negativa)
        this.circleRotation += speed * dt; // degrees
        this.normalizeRotation();
        this.cdr.detectChanges();
      }
      this.autoRotateRafId = requestAnimationFrame(loop);
    };
    this.autoRotateRafId = requestAnimationFrame(loop);
  }

  stopAutoRotate(): void {
    if (this.autoRotateRafId) {
      cancelAnimationFrame(this.autoRotateRafId);
      this.autoRotateRafId = null;
    }
  }

  scheduleAutoRotateResume(ms: number): void {
    // Reiniciar despues de ms ms
    setTimeout(() => {
      // si no está arrastrando, iniciar auto rotate
      if (!this.isPointerDown) {
        this.startAutoRotate();
      }
    }, ms);
  }

  // -------------------------
  // CONSTANT ROTATION (velocidad constante después del scroll)
  // -------------------------
  startConstantRotation(speed: number): void {
    // Cancelar cualquier rotación constante previa
    this.stopConstantRotation();
    
    this.constantRotationStartTime = performance.now();
    let last = performance.now();
    
    const loop = (t: number) => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      
      // Verificar si ha pasado el tiempo de duración
      const elapsed = now - this.constantRotationStartTime;
      if (elapsed >= this.constantRotationDuration) {
        // Detener la rotación constante
        this.stopConstantRotation();
        return;
      }
      
      // Solo aplicar si no está arrastrando
      if (!this.isPointerDown) {
        // Rotar a velocidad constante
        this.circleRotation += speed * dt; // degrees
        this.normalizeRotation();
        this.cdr.detectChanges();
      } else {
        // Si se está arrastrando, detener la rotación constante
        this.stopConstantRotation();
        return;
      }
      
      this.constantRotationRafId = requestAnimationFrame(loop);
    };
    
    this.constantRotationRafId = requestAnimationFrame(loop);
  }

  stopConstantRotation(): void {
    if (this.constantRotationRafId) {
      cancelAnimationFrame(this.constantRotationRafId);
      this.constantRotationRafId = null;
    }
  }

  // -------------------------
  // HOVER / ELEVACION (parallax visual extra)
  // -------------------------
  onCircleCardMouseEnter(event: MouseEvent, index: number): void {
    const el = event.currentTarget as HTMLElement;
    // scale up and add intensified shadow
    el.style.transform += ' scale(1.07)';
    el.style.boxShadow = '0 30px 60px rgba(2,6,23,0.18)';
    el.style.filter = 'brightness(1.02)';
  }

  onCircleCardMouseLeave(event: MouseEvent, index: number): void {
    const el = event.currentTarget as HTMLElement;
    // restore transform via recomputing position (safer)
    el.style.transform = this.getCircleCardTransform(index);
    el.style.boxShadow = '0 18px 48px rgba(2,6,23,0.14)';
    el.style.filter = 'none';
  }
  
  // Métodos legacy (mantener para compatibilidad si se usan en otros lugares)
  getScatteredTransform(index: number): string {
    // Usar el mismo método del círculo
    return this.getCircleCardTransform(index);
  }

  scrollGalleryLeft(): void {
    this.rotateCircleLeft();
  }

  scrollGalleryRight(): void {
    this.rotateCircleRight();
  }

  canScrollGalleryLeft(): boolean {
    // Siempre se puede rotar a la izquierda
    return true;
  }

  canScrollGalleryRight(): boolean {
    // Siempre se puede rotar a la derecha
    return true;
  }

  onGalleryScroll(): void {
    // Ya no se usa scroll, pero mantener el método para compatibilidad
  }

  scrollLeft() {
    if (this.reviewsContainer) {
      const container = this.reviewsContainer.nativeElement;
      const cardWidth = 96 + 12; // 24 (w-24) = 96px + gap (12px)
      const scrollAmount = cardWidth * 3; // Scroll 3 cards at a time
      container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
      this.currentScrollPosition = container.scrollLeft;
    }
  }

  scrollRight() {
    if (this.reviewsContainer) {
      const container = this.reviewsContainer.nativeElement;
      const cardWidth = 96 + 12; // 24 (w-24) = 96px + gap (12px)
      const scrollAmount = cardWidth * 3; // Scroll 3 cards at a time
      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
      this.currentScrollPosition = container.scrollLeft;
    }
  }

  canScrollLeft(): boolean {
    if (this.reviewsContainer?.nativeElement) {
      return this.reviewsContainer.nativeElement.scrollLeft > 10;
    }
    return false;
  }

  canScrollRight(): boolean {
    if (this.reviewsContainer?.nativeElement) {
      const container = this.reviewsContainer.nativeElement;
      const maxScroll = container.scrollWidth - container.clientWidth;
      return container.scrollLeft < maxScroll - 10; // 10px threshold
    }
    // Si hay más de 3 reseñas, mostrar la flecha derecha
    return this.allReviews.length > 3;
  }

  logout() {
    this.authService.logout().subscribe({
      next: () => {
        this.profile = null;
        this.error = null;
      },
      error: () => {
        this.error = 'Error al cerrar sesión';
      }
    });
  }

  onEditProfile(): void {
    this.router.navigate(['/app/profile/edit']);
  }

  // -------------------------
  // RESTO DE MÉTODOS (vinylSpin, edit, tabs, etc.)
  // -------------------------
  vinylSpin(review: any, event: MouseEvent): void {
    const card = event.currentTarget as HTMLElement;
    if (!card) return;
    card.style.transition = 'transform 0.6s cubic-bezier(.2,.9,.3,1)';
    card.style.transform += ' rotate(360deg)';
    setTimeout(() => { card.style.transform = card.style.transform.replace(' rotate(360deg)', ''); }, 600);
    // this.router.navigate(['/review', review.spotify_id]); // opcional
  }

  // ---------------------------------------------------------------------------
  // 🖱️ MANEJO DE EVENTOS DE MOUSE
  // ---------------------------------------------------------------------------
  onButtonMouseDown(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (target) {
      target.style.transform = 'translateY(1px)';
    }
  }

  onButtonMouseUp(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (target) {
      target.style.transform = 'translateY(0)';
    }
  }

  onCardMouseEnter(event: MouseEvent, index: number): void {
    const target = event.currentTarget as HTMLElement;
    if (target) {
      target.style.transform = `scale(1.03) rotate(${this.getScatteredAngle(index)}deg)`;
    }
  }

  onCardMouseLeave(event: MouseEvent, index: number): void {
    const target = event.currentTarget as HTMLElement;
    if (target) {
      target.style.transform = `rotate(${this.getScatteredAngle(index)}deg)`;
    }
  }

  onLatestReviewMouseEnter(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (target) {
      target.style.transform = 'translateY(-6px) rotate(-2deg)';
    }
  }

  onLatestReviewMouseLeave(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (target) {
      target.style.transform = 'translateY(0) rotate(0deg)';
    }
  }

  // -------------------------
  // UTIL & HELPERS
  // -------------------------
  normalizeAngle(a: number): number {
    return ((a % 360) + 360) % 360;
  }

  // -------------------------
  // RESTO DE MÉTODOS (vinylSpin, edit, tabs, etc.)
  // -------------------------
  // Obtener el elemento del círculo basado en el índice mostrado (con repetición infinita)
  getCircleReview(index: number): any {
    const totalOriginal = this.reviews.length || 1;
    // Usar el índice directamente del displayedCircleReviews, que ya tiene la repetición correcta
    if (this.displayedCircleReviews && this.displayedCircleReviews[index]) {
      return this.displayedCircleReviews[index];
    }
    // Fallback: calcular usando módulo
    const originalIndex = index % totalOriginal;
    return this.reviews[originalIndex];
  }

  openReview(r: any): void {
    // Si el elemento tiene un índice original, usar el elemento original
    const originalReview = r.originalIndex !== undefined ? this.reviews[r.originalIndex] : r;
    console.log('abrir', originalReview);
    // this.router.navigate(['/review', originalReview.spotify_id]); // opcional
  }

  // ---------------------------------------------------------------------------
  // ↔️ SCROLL ÚLTIMAS RESEÑAS
  // Controla flechas izquierda/derecha para las últimas reseñas
  // ---------------------------------------------------------------------------
  canScrollLatestLeft(): boolean {
    return this.canScrollLatestLeftValue;
  }

  canScrollLatestRight(): boolean {
    return this.canScrollLatestRightValue;
  }
  
  private updateLatestScrollButtons(): void {
    if (!this.latestReviewsContainer?.nativeElement) {
      this.canScrollLatestLeftValue = false;
      this.canScrollLatestRightValue = false;
      return;
    }
    const el = this.latestReviewsContainer.nativeElement;
    this.canScrollLatestLeftValue = el.scrollLeft > 10;
    this.canScrollLatestRightValue = el.scrollLeft < el.scrollWidth - el.clientWidth - 10;
  }

  scrollLatestLeft(): void {
    if (this.latestReviewsContainer?.nativeElement) {
      // Mismo desplazamiento que la galería principal
      this.latestReviewsContainer.nativeElement.scrollBy({ left: -180, behavior: 'smooth' });
    }
  }

  scrollLatestRight(): void {
    if (this.latestReviewsContainer?.nativeElement) {
      // Mismo desplazamiento que la galería principal
      this.latestReviewsContainer.nativeElement.scrollBy({ left: 180, behavior: 'smooth' });
    }
  }

  onLatestReviewsScroll(): void {
    // Actualizar las propiedades de visibilidad de las flechas
    this.updateLatestScrollButtons();
  }

  // ---------------------------------------------------------------------------
  // 🔐 MANEJO DE ERRORES
  // ---------------------------------------------------------------------------
  clearErrorAfterDelay(): void {
    if (!this.error) return;
    setTimeout(() => (this.error = null), 3200);
  }

  // ---------------------------------------------------------------------------
  // 🚀 CARGA DE DATOS (Método alternativo)
  // Reemplaza estas simulaciones con tus llamadas reales al servicio/API
  // ---------------------------------------------------------------------------
  loadProfileData(): void {
    try {
      // Este método puede ser usado como alternativa a loadMockData()
      // Simulación de ejemplo, reemplaza con tu servicio real
      this.profile = {
        display_name: 'Tu Nombre',
        bio: 'Amante de la música y vinilos 🎧',
        images: [
          {
            url: 'https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?w=400&h=400&fit=crop&crop=faces',
          },
        ],
      };

      this.followers = 128;
      this.following = 93;
      this.records = 42;

      // Simulamos 3 últimas reseñas
      this.latestReviews = [
        { spotify_id: '1A', album_image: 'https://i.imgur.com/Z7AzH2c.jpeg', title: 'Album 1' },
        { spotify_id: '1B', album_image: 'https://i.imgur.com/v6rFfVj.jpeg', title: 'Album 2' },
        { spotify_id: '1C', album_image: 'https://i.imgur.com/jvJpF4q.jpeg', title: 'Album 3' },
      ];

      // Simulamos galería grande (usa 8 como ejemplo)
      this.reviews = Array.from({ length: 8 }).map((_, i) => ({
        spotify_id: `ID${i}`,
        album_image: `https://picsum.photos/seed/album${i}/400`,
        title: `Album ${i}`,
      }));

      this.allReviews = this.reviews;
      this.updateDisplayedReviews();

    } catch (err: any) {
      this.error = 'Error al cargar el perfil';
      console.error(err);
      this.clearErrorAfterDelay();
    }
  }

  // -------------------------
  // CLEANUP: Cuando el componente se destruya, cancelar RAFs
  // -------------------------
  ngOnDestroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.inertiaRafId) cancelAnimationFrame(this.inertiaRafId);
    if (this.autoRotateRafId) cancelAnimationFrame(this.autoRotateRafId);
    if (this.constantRotationRafId) cancelAnimationFrame(this.constantRotationRafId);
    window.removeEventListener('resize', () => this.calculateCircleContainerWidth());
  }
}

