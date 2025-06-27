import React, { useState, useEffect, useRef, useCallback } from 'react';
// Tone.js will be loaded dynamically by this component.
// For this React component, we assume 'Tone' is available globally once loaded.

const App = () => {
  // State to control whether audio has been initiated (splash screen active or not)
  const [audioInitiated, setAudioInitiated] = useState(false);
  // State to track if Tone.js is confirmed loaded and ready for interaction
  const [isToneLoaded, setIsToneLoaded] = useState(false);
  // State to track if the background rhythms are currently playing (true by default after initiation)
  const [isTransportRunning, setIsTransportRunning] = useState(false);

  // Hardcoded polyrhythm definitions for the continuous central pulses
  const continuousRhythmDefs = useRef([
    // Added 'oscillatorType' for subtle audio distinction
    { id: 1, beats: 3, subdivision: 4, frequency: 220, decay: 1.0, oscillatorType: 'sine' },
    { id: 2, beats: 4, subdivision: 4, frequency: 330, decay: 1.2, oscillatorType: 'triangle' },
    { id: 3, beats: 5, subdivision: 8, frequency: 440, decay: 0.8, oscillatorType: 'square' },
  ]);

  // Definition for the oddmeter rhythm triggered by mouse movement
  // 'baseFrequency' is now a reference, actual frequency is derived from scale
  const mouseRhythmDef = useRef({
    id: 'mouse', beats: 7, subdivision: 8, baseFrequency: 440, decay: 0.5, oscillatorType: 'sawtooth'
  });

  // C Major Pentatonic Scale MIDI notes for harmonic ripples
  // C4, D4, E4, G4, A4, C5, D5, E5 (60, 62, 64, 67, 69, 72, 74, 76)
  const pentatonicScale = useRef([60, 62, 64, 67, 69, 72, 74, 76]);

  // Ref to store active visual pulses for the central rhythms
  const centralPulsesRef = useRef([]);
  // Ref to store active visual ripples for mouse interaction
  const mouseRipplesRef = useRef([]);
  // Ref to generate unique IDs for pulses and particles
  const idCounter = useRef(0); // Renamed to be general for all visual elements

  // Ref to store active white particles
  const particlesRef = useRef([]);
  // Constants for particle behavior
  const PARTICLE_DENSITY = 0.0005; // Adjust this value to control how many particles are spawned (higher = more)
  const MAX_PARTICLE_COUNT = 300; // Limit the total number of particles to maintain performance
  const PARTICLE_MIN_SIZE = 1;
  const PARTICLE_MAX_SIZE = 3;
  const PARTICLE_MIN_SPEED = 0.5;
  const PARTICLE_MAX_SPEED = 1.5;
  const PARTICLE_FADE_DISTANCE_RATIO = 0.3; // Particles start fading when this close to center

  // Refs to hold Tone.js objects (Synths and Sequences)
  const synthsRef = useRef([]); // For continuous rhythms
  const mouseSynthRef = useRef(null); // For the mouse-triggered rhythm
  const sequencesRef = useRef([]); // For continuous rhythm sequences

  // Ref for the canvas element
  const canvasRef = useRef(null);
  // Ref for the animation frame ID to control the drawing loop
  const animationFrameId = useRef(null);

  // Ref for mouse move throttle timer
  const throttleTimerRef = useRef(null);
  const THROTTLE_INTERVAL = 75; // milliseconds to limit mouse audio triggers for a snappier feel

  // Parameters for dynamic tempo modulation
  const TEMPO_MOD_MIN = 70; // BPM
  const TEMPO_MOD_MAX = 90; // BPM
  const TEMPO_MOD_SPEED = 0.05; // How fast the tempo modulates (smaller = slower)

  // Parameters for background grid
  const GRID_LINE_COUNT = 15; // Number of horizontal/vertical lines (creates GRID_LINE_COUNT x GRID_LINE_COUNT squares)
  const GRID_BASE_OPACITY = 0.03; // Very subtle base opacity
  const GRID_OPACITY_PULSE_AMOUNT = 0.02; // How much opacity pulsates
  const GRID_PULSE_SPEED = 0.1; // Speed of opacity pulsation
  const GRID_WOBBLE_AMOUNT = 5; // Max pixels of wobble for grid lines
  const GRID_WOBBLE_SPEED = 0.02; // Speed of wobble

  // --- Dynamic Tone.js Loading ---
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js";
    script.async = true;

    script.onload = () => {
      if (typeof Tone !== 'undefined' && Tone.Destination) {
        setIsToneLoaded(true);
        Tone.Transport.bpm.value = (TEMPO_MOD_MIN + TEMPO_MOD_MAX) / 2; // Set initial tempo to average
      } else {
        console.error("Tone.js loaded but 'Tone' object or 'Tone.Destination' is not defined.");
      }
    };

    script.onerror = (e) => {
      console.error("Failed to load Tone.js script:", e);
    };

    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, []);

  // --- Audio Setup (Synths and Sequences) ---
  useEffect(() => {
    if (!isToneLoaded || !audioInitiated) {
      return;
    }

    // Dispose previous synths/sequences
    synthsRef.current.forEach(s => s && s.dispose());
    sequencesRef.current.forEach(s => s && s.dispose());
    if (mouseSynthRef.current) {
      mouseSynthRef.current.dispose();
    }
    synthsRef.current = [];
    sequencesRef.current = [];
    mouseSynthRef.current = null;

    // Create synths and sequences for continuous rhythms
    continuousRhythmDefs.current.forEach((rhythm, index) => {
      const synth = new Tone.MonoSynth({
        oscillator: { type: rhythm.oscillatorType },
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.05, release: 0.2 },
      }).toDestination();
      synthsRef.current[index] = synth;

      const sequence = new Tone.Sequence((time, step) => {
        synth.triggerAttackRelease(rhythm.frequency, "16n", time);
        centralPulsesRef.current.push({
          id: idCounter.current++, // Use general id counter
          rhythmId: rhythm.id,
          startTime: Tone.Transport.now(),
          decayTime: rhythm.decay,
        });
      }, Array.from({ length: rhythm.beats }, (_, i) => i), `${rhythm.subdivision}n`);

      sequence.loop = true;
      sequence.start(0); // Sequences start with transport
      sequencesRef.current[index] = sequence;
    });

    // Create synth for mouse-triggered rhythm
    mouseSynthRef.current = new Tone.MonoSynth({
      oscillator: { type: mouseRhythmDef.current.oscillatorType },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0.01, release: 0.2 },
    }).toDestination();

    // Cleanup: dispose all audio components
    return () => {
      sequencesRef.current.forEach(s => s && s.dispose());
      synthsRef.current.forEach(s => s && s.dispose());
      if (mouseSynthRef.current) {
        mouseSynthRef.current.dispose();
      }
      // Ensure transport is stopped when component unmounts or audio is reset
      if (Tone.Transport && Tone.Transport.state === 'started') {
        Tone.Transport.stop();
      }
    };
  }, [audioInitiated, isToneLoaded]);

  // --- Mouse Move Handler for Ripples and Audio ---
  const handleMouseMove = useCallback((event) => {
    if (!audioInitiated || !mouseSynthRef.current) return;

    if (throttleTimerRef.current) {
      return;
    }

    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null; // Clear timer after interval
    }, THROTTLE_INTERVAL);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Calculate distance from center for pitch variance
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Map distance to an index within the pentatonic scale
    // Normalize distance from 0 to 1
    const maxDimension = Math.max(canvas.width, canvas.height); // Use max dimension for broader range
    const normalizedDistance = Math.min(1, distance / (maxDimension / 2)); // Clamp to 1

    // Map normalizedDistance to an index in the scale array
    const scaleIndex = Math.floor(normalizedDistance * (pentatonicScale.current.length - 1));
    const midiNote = pentatonicScale.current[scaleIndex];
    const frequency = Tone.Midi(midiNote).toFrequency(); // Convert MIDI note to frequency

    // Trigger mouse rhythm sound with dynamic harmonic frequency
    mouseSynthRef.current.triggerAttackRelease(
      frequency, "64n", Tone.Transport.now()
    );

    // Add a new ripple (circle) to be drawn
    mouseRipplesRef.current.push({
      id: idCounter.current++, // Use general id counter
      startTime: Tone.Transport.now(),
      decayTime: mouseRhythmDef.current.decay,
      x: x,
      y: y,
    });
  }, [audioInitiated]);

  // --- Canvas Click Handler for Freezing/Unfreezing Background Rhythms ---
  const handleCanvasClick = useCallback(() => {
    if (!audioInitiated) return;

    if (isTransportRunning) {
      Tone.Transport.stop();
    } else {
      Tone.Transport.start();
    }
    setIsTransportRunning(!isTransportRunning); // Toggle the state
  }, [audioInitiated, isTransportRunning]);


  // --- Canvas Drawing Logic ---
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxPulseRadius = Math.min(width, height) * 0.45;
    const maxRippleRadius = Math.min(width, height) * 0.25;

    // Get current time for animations
    const currentTime = Tone.Transport.now(); // Synchronized with audio transport

    // --- Dynamic Tempo Modulation ---
    // Modulate BPM based on a sine wave over time
    if (isTransportRunning && Tone.Transport) {
        const tempoOffset = Math.sin(currentTime * TEMPO_MOD_SPEED) * ((TEMPO_MOD_MAX - TEMPO_MOD_MIN) / 2);
        Tone.Transport.bpm.value = ((TEMPO_MOD_MIN + TEMPO_MOD_MAX) / 2) + tempoOffset;
    }

    // Clear canvas with a black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // --- Draw Subtle Animated Background Grid ---
    if (audioInitiated) {
      ctx.save(); // Save context before drawing grid to isolate transformations/filters

      // Grid opacity pulsation
      const currentGridOpacity = GRID_BASE_OPACITY + (Math.sin(currentTime * GRID_PULSE_SPEED) * GRID_OPACITY_PULSE_AMOUNT);
      ctx.strokeStyle = `rgba(255, 255, 255, ${currentGridOpacity})`;
      ctx.lineWidth = 0.5; // Very thin lines

      const cellSize = width / GRID_LINE_COUNT; // Size of each grid cell

      // Apply a subtle wobble effect to the grid's origin
      const wobbleX = Math.sin(currentTime * GRID_WOBBLE_SPEED) * GRID_WOBBLE_AMOUNT;
      const wobbleY = Math.cos(currentTime * GRID_WOBBLE_SPEED * 0.7) * GRID_WOBBLE_AMOUNT; // Different speed for y

      ctx.translate(wobbleX, wobbleY); // Translate the grid

      // Draw vertical lines
      for (let i = 0; i <= GRID_LINE_COUNT; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cellSize, 0);
        ctx.lineTo(i * cellSize, height);
        ctx.stroke();
      }
      // Draw horizontal lines
      for (let i = 0; i <= GRID_LINE_COUNT; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * cellSize);
        ctx.lineTo(width, i * cellSize);
        ctx.stroke();
      }
      ctx.restore(); // Restore context to remove grid transformations/filters
    }

    // --- Generate new particles ---
    if (audioInitiated && particlesRef.current.length < MAX_PARTICLE_COUNT) {
      // Generate particles based on canvas area and density
      const newParticlesToGenerate = Math.floor((width * height) * PARTICLE_DENSITY) - particlesRef.current.length;

      for (let i = 0; i < newParticlesToGenerate; i++) {
        // Randomly choose an edge to spawn from
        const edge = Math.floor(Math.random() * 4); // 0: top, 1: right, 2: bottom, 3: left
        let startX, startY;

        switch (edge) {
          case 0: // Top edge
            startX = Math.random() * width;
            startY = 0;
            break;
          case 1: // Right edge
            startX = width;
            startY = Math.random() * height;
            break;
          case 2: // Bottom edge
            startX = Math.random() * width;
            startY = height;
            break;
          case 3: // Left edge
            startX = 0;
            startY = Math.random() * height;
            break;
        }

        particlesRef.current.push({
          id: idCounter.current++,
          x: startX,
          y: startY,
          size: PARTICLE_MIN_SIZE + Math.random() * (PARTICLE_MAX_SIZE - PARTICLE_MIN_SIZE),
          speed: PARTICLE_MIN_SPEED + Math.random() * (PARTICLE_MAX_SPEED - PARTICLE_MIN_SPEED),
          opacity: 1, // Start fully opaque
          creationTime: currentTime,
        });
      }
    }

    // --- Update and Draw Particles ---
    particlesRef.current = particlesRef.current.filter(particle => {
      // Calculate direction vector to center
      const dx = centerX - particle.x;
      const dy = centerY - particle.y;
      const distanceToCenter = Math.sqrt(dx * dx + dy * dy);

      // Normalize direction vector
      const normDx = dx / distanceToCenter;
      const normDy = dy / distanceToCenter;

      // Move particle towards center
      particle.x += normDx * particle.speed;
      particle.y += normDy * particle.speed;

      // Fade out as it gets closer to the center
      const fadeThreshold = Math.min(width, height) * PARTICLE_FADE_DISTANCE_RATIO;
      if (distanceToCenter < fadeThreshold) {
        particle.opacity = Math.max(0, distanceToCenter / fadeThreshold);
      } else {
        particle.opacity = 1; // Fully opaque outside fade threshold
      }

      // Remove particle if it's very close to the center or fully faded
      if (distanceToCenter < particle.size || particle.opacity <= 0.01) {
        return false;
      }

      // Draw particle
      ctx.fillStyle = `rgba(255, 255, 255, ${particle.opacity})`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size / 2, 0, Math.PI * 2);
      ctx.fill();

      return true; // Keep particle if still visible
    });


    if (audioInitiated) {
      // Draw and filter central pulses (expanding circles with blur)
      centralPulsesRef.current = centralPulsesRef.current.filter(pulse => {
        const elapsedTime = currentTime - pulse.startTime;
        const normalizedTime = elapsedTime / pulse.decayTime;

        if (normalizedTime >= 1) return false;

        const radius = maxPulseRadius * normalizedTime;
        const opacity = 1 - normalizedTime;

        // Calculate blur amount: starts at 0, increases to max (e.g., 8px), then decreases to 0
        const maxBlur = 8; // Maximum blur in pixels
        const blurAmount = maxBlur * 4 * normalizedTime * (1 - normalizedTime); // Parabolic curve

        ctx.save(); // Save context state before applying filter
        ctx.filter = `blur(${blurAmount}px)`;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore(); // Restore context state (removes filter for next drawings)
        return true;
      });

      // Draw and filter mouse ripples (expanding circles)
      mouseRipplesRef.current = mouseRipplesRef.current.filter(ripple => {
        const elapsedTime = currentTime - ripple.startTime;
        const normalizedTime = elapsedTime / ripple.decayTime;

        if (normalizedTime >= 1) return false;

        const radius = maxRippleRadius * normalizedTime;
        const opacity = 1 - normalizedTime;

        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        return true;
      });
    }

    animationFrameId.current = requestAnimationFrame(draw);
  }, [audioInitiated, isTransportRunning]); // Added isTransportRunning to dependencies for tempo modulation

  // This useEffect sets up canvas responsiveness and starts/stops the animation loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const updateCanvasSize = () => {
      if (canvas) {
        const parent = canvas.parentElement;
        canvas.width = parent ? parent.clientWidth : window.innerWidth;
        canvas.height = canvas.width;
      }
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    animationFrameId.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrameId.current);
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [draw]);

  // --- Splash Screen Button Handler ---
  const handleInitiateAudio = useCallback(async () => {
    if (!isToneLoaded) {
      return;
    }
    if (audioInitiated) {
        return;
    }

    try {
      await Tone.start(); // This starts the audio context
      setAudioInitiated(true); // Hide splash screen, show art piece
      Tone.Transport.start(); // Start the Tone.js global transport
      setIsTransportRunning(true); // Set transport as running initially
    } catch (error) {
      console.error("Failed to start Tone.js audio context:", error);
    }
  }, [isToneLoaded, audioInitiated]);

  // --- Render Component UI ---
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white font-inter">
      {/* Conditional rendering for splash screen vs. art piece */}
      {!audioInitiated ? (
        // Splash Screen
        <div className="flex items-center justify-center w-full h-screen bg-black">
          <button
            onClick={handleInitiateAudio}
            className="w-5 h-5 md:w-6 md:h-6 bg-white rounded-full flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-75 transition-transform hover:scale-110 cursor-pointer"
            disabled={!isToneLoaded}
            aria-label="Initiate Audio"
          >
            {/* No text or graphics inside the button */}
          </button>
        </div>
      ) : (
        // Main Art Piece Canvas
        <div className="relative w-full h-full flex-grow flex items-center justify-center p-4">
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onClick={handleCanvasClick}
            className="w-full max-w-2xl aspect-square rounded-full border-2 border-transparent"
            style={{backgroundColor: 'black'}}
          ></canvas>
        </div>
      )}
    </div>
  );
};

export default App;
