import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import ndarray from 'ndarray';
import noUiSlider from 'nouislider';
import npyjs from 'npyjs';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { evaluate_cmap } from "./colormap.js";

let NUM_SURFACES = 10;
const axis_labels = [
    'x',
    'x\u1d62', // unicode subscript i
    't',
    'Q\u00b2' // unicode superscript 2
];
let chosen_vars = [1, 3]        // xi, Q2
let remaining_vars = [0, 2];    // x, t
let control_index = [0, 0];
let dataFiles = [
    { name: "x values (x.npy)", path: "data/x.npy", key: 'x', type: 'npy' },
    { name: "xi values (xi.npy)", path: "data/xi.npy", key: 'xi', type: 'npy' },
    { name: "t values (t.npy)", path: "data/t.npy", key: 't', type: 'npy' },
    { name: "Q² values (Q2.npy)", path: "data/Q2.npy", key: 'Q2', type: 'npy' },
    { name: "GPD data (gpd_4d.npy)", path: "data/gpd_4d.npy", key: 'gpd_4d', type: 'npy' },
];
let min_gpd = Number.MAX_VALUE;
let max_gpd = Number.MIN_VALUE;
let slider_changed = true;
let updated_axis = true;

let upload_overlay = document.getElementById('data-upload-overlay');
let loading_overlay = document.getElementById('loading-overlay');
let main_content = document.getElementById('main-content');

const dropdown1 = document.getElementById('dropdown1');
const dropdown2 = document.getElementById('dropdown2');
const slider_1 = document.getElementById('slider_1');
const slider_2 = document.getElementById('slider_2');
const playSlider1Btn = document.getElementById('play-slider1');
const playSlider2Btn = document.getElementById('play-slider2');

const toggleViewBtn = document.getElementById('toggle-view-btn');
const resetViewBtn = document.getElementById('reset-view-btn');
const colormapSelect = document.getElementById('colormap-select');

// Only allow diverging colormaps for single colormap
let divergingColormaps = ['coolwarm', 'RdBu', 'Spectral', 'PiYG', 'PRGn', 'BrBG', 'PuOr', 'RdGy', 'RdYlBu', 'RdYlGn'];
let currentColormap = 'coolwarm';

// Remove dual colormap toggle and controls from DOM
if (document.getElementById('dual-colormap-toggle')) {
    document.getElementById('dual-colormap-toggle').style.display = 'none';
}
if (document.getElementById('dual-colormap-controls')) {
    document.getElementById('dual-colormap-controls').style.display = 'none';
}
if (document.getElementById('single-colormap-controls')) {
    document.getElementById('single-colormap-controls').style.display = 'flex';
}

// Restrict colormapSelect to diverging colormaps only
if (colormapSelect) {
    colormapSelect.innerHTML = '';
    divergingColormaps.forEach(cmap => {
        let opt = document.createElement('option');
        opt.value = cmap;
        opt.textContent = cmap;
        colormapSelect.appendChild(opt);
    });
    colormapSelect.value = currentColormap;
}

function create_axis_label(text, color) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 400
    canvas.height = 400
    context.font = 'Bold 100px Arial';
    context.fillStyle = color;
    context.fillText(text, canvas.width / 2 - 50, canvas.height / 2 + 50);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    return sprite;
}

function create_axis_line(start, end, width, color){
    const geometry = new LineSegmentsGeometry().setPositions([start.x, start.y, start.z, end.x, end.y, end.z])
    const material = new LineMaterial({
        color: color,   
        linewidth: width
    });
    return new LineSegments2(geometry, material);
}

function create_axis(center, width=8.0, scale=0.5, labelx="x", labely="y", labelz="z", colorx = '#ff0000', colory='#00ff00', colorz='#0000ff') {
    let x_axis = create_axis_line(center, new THREE.Vector3(center.x + scale, center.y, center.z), width, colorx)
    let y_axis = create_axis_line(center, new THREE.Vector3(center.x, center.y + scale, center.z), width, colory)
    let z_axis = create_axis_line(center, new THREE.Vector3(center.x, center.y, center.z + scale), width, colorz)
    let x_label = create_axis_label(labelx, colorx)
    let y_label = create_axis_label(labely, colory)
    let z_label = create_axis_label(labelz, colorz)
    x_label.position.set(center.x + scale + 0.5, center.y, center.z);
    y_label.position.set(center.x, center.y + scale + 0.5, center.z);
    z_label.position.set(center.x, center.y, center.z + scale + 0.5);
    return [x_axis, y_axis, z_axis, x_label, y_label, z_label];
}

function get_extreme(arr){
    let maxv = Number.MIN_VALUE;
    let minv = Number.MAX_VALUE;
    arr.forEach(val => {
        maxv = Math.max(maxv, val)
        minv = Math.min(minv, val)
    })
    return [minv, maxv];
}

function load_array(url) {
    return fetch(url).then(response => {
        if (!response.ok) {
            throw new Error(`Failed to load ${url}, status: ${response.status}`);
        }
        return response.arrayBuffer();
    });
}

function load_data_files() {
    const loadingText = document.querySelector('#loading-overlay .loading-text');
    function load_file(path, type) {
        if (path) {
            const npy = new npyjs();
            if (type === 'npy') {
                return npy.load(path).then(obj => {
                    return new Float64Array(Array.from(obj.data));
                });
            }
            else {
                return load_array(path);
            }
        }
    }

    const results = [];
    for (const file of dataFiles) {
        if (loadingText) {
            loadingText.textContent = `Loading ${file.name}...`;
        }
        results.push(load_file(file.path, file.type));
    }
    return results;
}

// Notification system
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    // Use the dedicated notification container
    const notificationContainer = document.getElementById('notification-container');
    if (!notificationContainer) return;
    notificationContainer.appendChild(notification);
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Function to update scene info display
function updateSceneInfo(message) {
    const sceneInfo = document.getElementById('scene-info');
    if (sceneInfo) {
        sceneInfo.textContent = message;
    }
}

// Update slider labels to show remaining variables
function updateSliderLabels() {
    remaining_vars = [0, 1, 2, 3].filter(i => !chosen_vars.includes(i));
    document.getElementById('slider1-label').textContent = axis_labels[remaining_vars[0]] + ': ';
    document.getElementById('slider2-label').textContent = axis_labels[remaining_vars[1]] + ': ';
}

function updateColorbar(min, max, colormap) {
    // Update min/max labels
    const colorbarLabels = document.querySelectorAll('.colorbar-labels');
    if (colorbarLabels.length >= 2) {
        colorbarLabels[0].textContent = max.toFixed(3);
        colorbarLabels[1].textContent = min.toFixed(3);
    }
    // Update colorbar gradient
    const colorbar = document.querySelector('.colorbar');
    if (colorbar) {
        let stops = [];
        for (let i = 0; i <= 100; i += 10) {
            const value = i / 100;
            let rgb = evaluate_cmap(value, colormap, false);
            if (!rgb || rgb.length !== 3) {
                rgb = [255, 255, 255]; // fallback to white if colormap is invalid
            }
            stops.push(`rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])}) ${i}%`);
        }
        colorbar.style.background = `linear-gradient(to top, ${stops.join(', ')})`;
    }
}
 
function animateSlider(slider, dataArray, idx, playBtn, playingFlag, intervalVar) {
    // stop any existing animation
    if (window[playingFlag]) {
        window[playingFlag] = false;
        playBtn.innerHTML = '<i class="fas fa-play"></i>';
        clearInterval(window[intervalVar]);
        window[intervalVar] = null;
        return;
    }

    window[playingFlag] = true;
    playBtn.innerHTML = '<i class="fas fa-pause"></i>';

    window[intervalVar] = setInterval(() => {
        if (!window[playingFlag]) {
            clearInterval(window[intervalVar]);
            window[intervalVar] = null;
            playBtn.innerHTML = '<i class="fas fa-play"></i>';
            return;
        }

        let current = control_index[idx];
        current++;
        if (current > dataArray.length - 1) {
            current = 0; // Loop back to the start
        }
        control_index[idx] = current;
        slider_changed = true;
        slider.noUiSlider.set(current);
        updateColorbar(min_gpd, max_gpd, currentColormap);

        // Show multiple surfaces if multi-surface mode is active
        if (multiSurfaceActive === idx) {
            showMultipleSurfaces(idx);
        }
    }, 200);
}

// --- Data Upload Handling ---
window.addEventListener('DOMContentLoaded', () => {
    const upload_form = document.getElementById('data-upload-form');
    const skipBtn = document.getElementById('skip-upload-btn');

    skipBtn.addEventListener('click', () => {
        upload_overlay.style.display = 'none';
        gpd_vis();
    });

    upload_form.addEventListener('submit', async (e) => {
        e.preventDefault();
        upload_overlay.style.display = 'none';
        const xFile = document.getElementById('file-x').files[0];
        const xiFile = document.getElementById('file-xi').files[0];
        const tFile = document.getElementById('file-t').files[0];
        const Q2File = document.getElementById('file-Q2').files[0];
        const gpd4dFile = document.getElementById('file-gpd4d').files[0];
        if (!(xFile && xiFile && tFile && Q2File && gpd4dFile)) {
            alert('Please select all required files.');
            return;
        }

        // Helper function to determine file type from filename
        function getFileType(filename) {
            const extension = filename.toLowerCase().split('.').pop();
            return extension === 'npy' ? 'npy' : 'bin';
        }

        const xURL = URL.createObjectURL(xFile);
        const xiURL = URL.createObjectURL(xiFile);
        const tURL = URL.createObjectURL(tFile);
        const Q2URL = URL.createObjectURL(Q2File);
        const gpd4dURL = URL.createObjectURL(gpd4dFile);

        // Update paths and file types based on uploaded files
        dataFiles[0].path = xURL;
        dataFiles[0].type = getFileType(xFile.name);
        dataFiles[1].path = xiURL;
        dataFiles[1].type = getFileType(xiFile.name);
        dataFiles[2].path = tURL;
        dataFiles[2].type = getFileType(tFile.name);
        dataFiles[3].path = Q2URL;
        dataFiles[3].type = getFileType(Q2File.name);
        dataFiles[4].path = gpd4dURL;
        dataFiles[4].type = getFileType(gpd4dFile.name);

        console.log("Updated dataFiles types:", dataFiles.map(f => ({ key: f.key, type: f.type })));

        gpd_vis();
    });
});

// Revoke any created object URLs when the page unloads
window.addEventListener('beforeunload', () => {
    revokeCreatedObjectURLs();
});

function gpd_vis() {
    Promise.all(load_data_files())
    .then(([x, xi, t, Q2, gpd_4d_flat]) => {
        x = new Float64Array(x);
        xi = new Float64Array(xi);
        t = new Float64Array(t);
        Q2 = new Float64Array(Q2);
        gpd_4d_flat = new Float64Array(gpd_4d_flat);
    
        loading_overlay.style.display = 'none';
        main_content.style.display = 'block';
        dropdown1.value = chosen_vars[0];
        dropdown2.value = chosen_vars[1];
        colormapSelect.value = currentColormap;
        
        var x_xi_t_Q2_array = [x, xi, t, Q2];
        let dims = [x.length, xi.length, t.length, Q2.length];
        let gpd_4d = new ndarray(gpd_4d_flat, dims);
        [min_gpd, max_gpd] = get_extreme(gpd_4d_flat);
        let is2DView = false;
        let camera_3d_state = {};
    
        console.log("min_gpd:", min_gpd, "max_gpd:", max_gpd);
    
        // After you set min_gpd and max_gpd in your .then() block, update the colorbar labels:
        document.querySelectorAll('.colorbar-labels')[0].textContent = `${max_gpd.toFixed(3)}`;
        document.querySelectorAll('.colorbar-labels')[1].textContent = `${min_gpd.toFixed(3)}`;
    
        let container = document.getElementById("three-container")
        let camera = new THREE.PerspectiveCamera(75, container.clientWidth /  container.clientHeight, 0.1, 1000);
        camera.position.set(0.345, -0.597, 0.970);
        camera.quaternion.set(0.535, -0.134, 0.086, 0.829);
    
        let renderer = new THREE.WebGLRenderer({antialias:true});
        renderer.setClearColor("#52576e");
        renderer.setSize( container.clientWidth, container.clientHeight );
        container.appendChild(renderer.domElement)
    
        let controls = new TrackballControls(camera, renderer.domElement);
        controls.rotateSpeed = 3.0;
        controls.zoomSpeed = 1.0;
    
        let min_axis1, max_axis1, min_axis2, max_axis2;
        let arrays1 = [[], []];
        let arrays2 = [[], []];
        let scene;
        let positions;
        let colors;
        let axis_scene;
        let geometry;
    
        // Remove all lights for flat shading
        // Use MeshBasicMaterial so lighting does not affect the color
        let material = new THREE.MeshBasicMaterial({
            vertexColors: true,    // Use per-vertex color from colormap
            side: THREE.DoubleSide
        });
    
        let axis_camera = new THREE.OrthographicCamera(-2, 2, 2, -2, -1000, 1000);
    
        function animate() {
            if (updated_axis) {
                updated_axis = false;
    
                arrays1 = [x_xi_t_Q2_array[chosen_vars[0]], x_xi_t_Q2_array[chosen_vars[1]]];   // axes
                arrays2 = [x_xi_t_Q2_array[remaining_vars[0]], x_xi_t_Q2_array[remaining_vars[1]]]; // sliders
    
                [min_axis1, max_axis1] = get_extreme(arrays1[0]);
                [min_axis2, max_axis2] = get_extreme(arrays1[1]);
    
                slider_1.noUiSlider.updateOptions({
                    range: {
                        min: 0,
                        max: arrays2[0].length - 1
                    },
                    tooltips: { 
                        to: function (value) { return arrays2[0][Math.round(value)]; } 
                    },
                });
    
                slider_2.noUiSlider.updateOptions({
                    range: {
                        min: 0,
                        max: arrays2[1].length - 1
                    },
                    tooltips: { 
                        to: function (value) { return arrays2[1][Math.round(value)]; } 
                    },
                });
    
                scene = new THREE.Scene();
                geometry = new THREE.PlaneGeometry(1, 1, arrays1[0].length - 1, arrays1[1].length - 1);
                let plane = new THREE.Mesh(geometry, material);
                let global_axis = create_axis(new THREE.Vector3(0, 0, 0), 3.0, 2.0, axis_labels[chosen_vars[0]], axis_labels[chosen_vars[1]], "GPD");
                global_axis.forEach(element => { scene.add(element); });
                scene.add(plane);
    
                axis_scene = new THREE.Scene();
                let orient_axis = create_axis(new THREE.Vector3(0, 0, 0), 8.0, 0.5, axis_labels[chosen_vars[0]], axis_labels[chosen_vars[1]], "GPD");
                orient_axis.forEach(element => { axis_scene.add(element); });
    
                positions = geometry.attributes.position;
                colors = new Float32Array(positions.count * 3);
                for (let i = 0; i < positions.count; i++) {
                    let axis2_index = Math.floor(i / arrays1[0].length);
                    let axis1_index = i % arrays1[0].length;
                    let axis1_value = (arrays1[0][axis1_index] - min_axis1) / (max_axis1 - min_axis1);
                    let axis2_value = (arrays1[1][axis2_index] - min_axis2) / (max_axis2 - min_axis2);
                    positions.setX(i, axis1_value);
                    positions.setY(i, axis2_value);
                }
                controls.target.set(0.5, 0.5, 0.5);
                controls.update();
            }
    
            if (slider_changed) {
                slider_changed = false;
                for (let i = 0; i < positions.count; i++) {
                    let axis2_index = Math.floor(i / arrays1[0].length);
                    let axis1_index = i % arrays1[0].length;
                    let query_index = [0, 0, 0, 0];
                    query_index[remaining_vars[0]] = control_index[0];
                    query_index[remaining_vars[1]] = control_index[1];
                    query_index[chosen_vars[0]] = axis1_index;
                    query_index[chosen_vars[1]] = axis2_index;
                    let gpd_raw_value = gpd_4d.get(query_index[0], query_index[1], query_index[2], query_index[3]);
                    let gpd_value = (gpd_raw_value - min_gpd) / (max_gpd - min_gpd);
                    positions.setZ(i, is2DView ? 0 : gpd_value);
                    let color = evaluate_cmap(gpd_value, currentColormap, false);
                    colors[i * 3] = color[0] / 255.;
                    colors[i * 3 + 1] = color[1] / 255.;
                    colors[i * 3 + 2] = color[2] / 255.;
                }
                geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                positions.needsUpdate = true;
                geometry.computeVertexNormals();
            }
    
            renderer.setViewport(0, 0, container.clientWidth, container.clientHeight);
            controls.update();
            renderer.clear();
            renderer.render(scene, camera);
    
            axis_camera.quaternion.copy(camera.quaternion);
    
            renderer.clearDepth();  
            renderer.autoClear = false;
            renderer.setViewport(0, 0, 300, 300);
            renderer.render(axis_scene, axis_camera);
        }
        renderer.setAnimationLoop( animate );
    
        noUiSlider.create(slider_1, {
            start: [0],  
            tooltips: { 
                to: function (value) { return arrays2[0][Math.round(value)]; } 
            },
            step: 1,
            range: {
                min: 0,
                max: arrays2[0].length - 1
            },
        });
    
        noUiSlider.create(slider_2, {
            start: [0], 
            tooltips: { 
                to: function (value) { return arrays2[0][Math.round(value)]; } 
            },
            step: 1,
            range: {
                min: 0,
                max: arrays2[1].length - 1
            },
        });
    
        updateSliderLabels();
        updateColorbar(min_gpd, max_gpd, currentColormap);
        updateSceneInfo('Scene ready');
    
        function resetView() {
            // Reset main camera
            camera.position.set(0.345, -0.597, 0.970);
            camera.quaternion.set(0.535, -0.134, 0.086, 0.829);
            controls.target.set(0.5, 0.5, 0.5);
            controls.update();
            
            // Reset axis camera to default orthographic settings
            axis_camera.left = -2;
            axis_camera.right = 2;
            axis_camera.top = 2;
            axis_camera.bottom = -2;
            axis_camera.near = -1000;
            axis_camera.far = 1000;
            axis_camera.zoom = 1;
            axis_camera.updateProjectionMatrix();
            
            updateSceneInfo('View reset to default');
        }
    
        /* Add event listeners below */
        if (slider_1) {
            slider_1.noUiSlider.on('change', function(values, handle) {
                control_index[0] = Number(values[0]);
                slider_changed = true;
                if (multiSurfaceActive === 0) {
                    showMultipleSurfaces(0);
                } else {
                    clearMultiSurface();
                }
            });
            // Stop animation if user interacts with slider manually
            slider_1.noUiSlider.on('start', function() {
                if (window.slider1Playing) {
                    window.slider1Playing = false;
                    playSlider1Btn.innerHTML = '<i class="fas fa-play"></i>';
                    clearInterval(window.slider1Interval);
                    window.slider1Interval = null;
                }
            });
        }
        if (slider_2) {
            slider_2.noUiSlider.on('change', function(values, handle) {
                control_index[1] = Number(values[0]);
                slider_changed = true;
                if (multiSurfaceActive === 1) {
                    showMultipleSurfaces(1);
                } else {
                    clearMultiSurface();
                }
            });
            slider_2.noUiSlider.on('start', function() {
                if (window.slider2Playing) {
                    window.slider2Playing = false;
                    playSlider2Btn.innerHTML = '<i class="fas fa-play"></i>';
                    clearInterval(window.slider2Interval);
                    window.slider2Interval = null;
                }
            });
        }
    
        if (playSlider1Btn) {
            playSlider1Btn.addEventListener('click', function() {
                animateSlider(slider_1, arrays2[0], 0, playSlider1Btn, 'slider1Playing', 'slider1Interval');
            });
        }
        if (playSlider2Btn) {
            playSlider2Btn.addEventListener('click', function() {
                animateSlider(slider_2, arrays2[1], 1, playSlider2Btn, 'slider2Playing', 'slider2Interval');
            });
        }
    
        const multiSurface1Btn = document.getElementById('multi-surface1');
        const multiSurface2Btn = document.getElementById('multi-surface2');
        let multiSurfaceActive = null; // null, 0, or 1
    
        // Helper to stop any animation
        function stopAllAnimations() {
            if (window.slider1Playing) {
                window.slider1Playing = false;
                playSlider1Btn.innerHTML = '<i class="fas fa-play"></i>';
                clearInterval(window.slider1Interval);
                window.slider1Interval = null;
            }
            if (window.slider2Playing) {
                window.slider2Playing = false;
                playSlider2Btn.innerHTML = '<i class="fas fa-play"></i>';
                clearInterval(window.slider2Interval);
                window.slider2Interval = null;
            }
        }
    
        function showMultipleSurfaces(idx) {
            stopAllAnimations();
            multiSurfaceActive = idx;
            // Toggle button styles
            if (multiSurface1Btn) {
                multiSurface1Btn.classList.toggle('btn-secondary', idx === 0);
                multiSurface1Btn.classList.toggle('btn-outline-secondary', idx !== 0);
            }
            if (multiSurface2Btn) {
                multiSurface2Btn.classList.toggle('btn-secondary', idx === 1);
                multiSurface2Btn.classList.toggle('btn-outline-secondary', idx !== 1);
            }
            const offset = -5;
            const centerIdx = control_index[idx];
            const maxDistance = Math.floor(NUM_SURFACES / 2);
            const surfaces = [];
            for (let i = 0; i < NUM_SURFACES; i++) {
                let surfaceIdx = centerIdx + offset + i;
                // Clamp to valid range
                const arrLen = idx === 0 ? arrays2[0].length : arrays2[1].length;
                if (surfaceIdx < 0 || surfaceIdx >= arrLen) continue;
                // Opacity decreases with distance from center
                const distance = Math.abs(surfaceIdx - centerIdx);
                let opacity = 1 - (distance / maxDistance);
                opacity = Math.max(0.1, opacity);
    
                let surfaceGeometry = geometry.clone();
                let surfaceMaterial = material.clone();
                surfaceMaterial.transparent = true;
                surfaceMaterial.opacity = opacity;
                let surfacePositions = surfaceGeometry.attributes.position;
                let surfaceColors = new Float32Array(surfacePositions.count * 3);
                for (let j = 0; j < surfacePositions.count; j++) {
                    let axis2_index = Math.floor(j / arrays1[0].length);
                    let axis1_index = j % arrays1[0].length;
                    let query_index = [0, 0, 0, 0];
                    query_index[remaining_vars[0]] = idx === 0 ? surfaceIdx : control_index[0];
                    query_index[remaining_vars[1]] = idx === 1 ? surfaceIdx : control_index[1];
                    query_index[chosen_vars[0]] = axis1_index;
                    query_index[chosen_vars[1]] = axis2_index;
                    let gpd_raw_value = gpd_4d.get(query_index[0], query_index[1], query_index[2], query_index[3]);
                    let gpd_value = (gpd_raw_value - min_gpd) / (max_gpd - min_gpd);
                    surfacePositions.setZ(j, is2DView ? 0 : gpd_value);
                    let color = evaluate_cmap(gpd_value, currentColormap, false);
                    surfaceColors[j * 3] = color[0] / 255.;
                    surfaceColors[j * 3 + 1] = color[1] / 255.;
                    surfaceColors[j * 3 + 2] = color[2] / 255.;
                }
                surfaceGeometry.setAttribute('color', new THREE.BufferAttribute(surfaceColors, 3));
                surfacePositions.needsUpdate = true;
                surfaceGeometry.computeVertexNormals();
                let mesh = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
                surfaces.push(mesh);
            }
            // Remove previous multi-surface from scene
            if (scene.__multiSurfaces) {
                scene.__multiSurfaces.forEach(m => scene.remove(m));
            }
            // Add new ones
            surfaces.forEach(m => scene.add(m));
            scene.__multiSurfaces = surfaces;
            renderer.render(scene, camera);
        }
    
        function clearMultiSurface() {
            multiSurfaceActive = null;
            if (multiSurface1Btn) {
                multiSurface1Btn.classList.remove('btn-secondary');
                multiSurface1Btn.classList.add('btn-outline-secondary');
            }
            if (multiSurface2Btn) {
                multiSurface2Btn.classList.remove('btn-secondary');
                multiSurface2Btn.classList.add('btn-outline-secondary');
            }
            if (scene && scene.__multiSurfaces) {
                scene.__multiSurfaces.forEach(m => scene.remove(m));
                scene.__multiSurfaces = [];
                renderer.render(scene, camera);
            }
        }
    
        multiSurface1Btn.addEventListener('click', function() {
            if (multiSurfaceActive === 0) {
                clearMultiSurface();
            } else {
                showMultipleSurfaces(0);
            }
        });
        multiSurface2Btn.addEventListener('click', function() {
            if (multiSurfaceActive === 1) {
                clearMultiSurface();
            } else {
                showMultipleSurfaces(1);
            }
        });
    
        if (dropdown1) {
            dropdown1.addEventListener('change', function() {
                const selectedValue = Number(dropdown1.value);
                if (selectedValue == chosen_vars[1]){
                    showNotification("Please select two different axes!", "warning");
                    dropdown1.value = chosen_vars[0];
                    return;
                }
                chosen_vars[0] = selectedValue;
                updated_axis = true;
                slider_changed = true;
                control_index = [0, 0];
                slider_1.noUiSlider.set(0);
                slider_2.noUiSlider.set(0);
                updateSliderLabels();
                showNotification(`Primary axis changed to ${axis_labels[selectedValue]}`, "success");
                updateColorbar(min_gpd, max_gpd, currentColormap);
            });
        }
        if (dropdown2) {
            dropdown2.addEventListener('change', function() {
                const selectedValue = Number(dropdown2.value);
                if (selectedValue == chosen_vars[0]){
                    showNotification("Please select two different axes!", "warning");
                    dropdown2.value = chosen_vars[1];
                    return;
                }
                chosen_vars[1] = selectedValue;
                updated_axis = true;
                slider_changed = true;
                control_index = [0, 0];
                slider_1.noUiSlider.set(0);
                slider_2.noUiSlider.set(0);
                updateSliderLabels();
                showNotification(`Secondary axis changed to ${axis_labels[selectedValue]}`, "success");
                updateColorbar(min_gpd, max_gpd, currentColormap);
            });
        }
    
        if (toggleViewBtn) {
            toggleViewBtn.addEventListener('click', function() {
                is2DView = !is2DView;
                toggleViewBtn.innerHTML = is2DView
                    ? '<i class="fas fa-globe me-1"></i>3D View'
                    : '<i class="fas fa-map me-1"></i>2D Heatmap';
                updateSceneInfo(is2DView ? "Switched to 2D heatmap" : "Switched to 3D view");
                
                if (is2DView) {
                    // Save current 3D camera state
                    camera_3d_state.up = camera.up.clone();
                    camera_3d_state.position = camera.position.clone();
                    camera_3d_state.quaternion = camera.quaternion.clone();
                    camera_3d_state.target = controls.target.clone();
    
                    // Switch to 2D top-down view
                    camera.position.set(0.5, 0.5, 2);
                    camera.quaternion.set(0, 0, 0, 1); // Reset rotation
                    camera.up.set(0, 1, 0); // Ensure Y is up
                    controls.target.set(0.5, 0.5, 0);
                    controls.noRotate = true; // Disable rotation
                } else {
                    // Restore 3D camera state
                    if (camera_3d_state.position) {
                        camera.up.copy(camera_3d_state.up);
                        camera.position.copy(camera_3d_state.position);
                        camera.quaternion.copy(camera_3d_state.quaternion);
                        controls.target.copy(camera_3d_state.target);
                    } else {
                        // Fallback to reset view if no state saved
                        resetView();
                    }
                    controls.noRotate = false; // Enable rotation
                }
                controls.update();
            });
        }
    
        if (colormapSelect) {
            colormapSelect.addEventListener('change', function() {
                currentColormap = colormapSelect.value;
                showNotification(`Colormap changed to ${currentColormap}`, "info");
                slider_changed = true;
                updateColorbar(min_gpd, max_gpd, currentColormap);
            });
        }
    
        if (resetViewBtn) {
            resetViewBtn.addEventListener('click', resetView);
        }
    
        // Window resize handling
        window.addEventListener('resize', function() {
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        });
        
        // Keyboard shortcuts
        window.addEventListener('keydown', function(event) {
            if (event.ctrlKey && event.key === 'r') {
                event.preventDefault();
                resetView();
            }
        });
    
        const numSurfacesInput = document.getElementById('num-surfaces-input');
        if (numSurfacesInput) {
            numSurfacesInput.addEventListener('change', function() {
                let val = parseInt(numSurfacesInput.value, 10);
                if (isNaN(val) || val < 1) val = 1;
                if (val > 50) val = 50;
                NUM_SURFACES = val;
                numSurfacesInput.value = val;
                if (multiSurfaceActive === 0) showMultipleSurfaces(0);
                if (multiSurfaceActive === 1) showMultipleSurfaces(1);
            });
        }
    
    })
    .catch(error => {
        loading_overlay.style.display = 'none';
        main_content.innerHTML = `
            <div style="color: red; text-align: center; margin-top: 50px; padding: 20px;">
                <h3>Error Loading Data</h3>
                <p>Failed to create the visualization scene.</p>
                <div style="background-color: #ffebee; border: 1px solid #ffcdd2; border-radius: 4px; padding: 15px; margin: 20px auto; max-width: 600px; text-align: left;">
                    <strong>Error Details:</strong><br>
                    <code style="word-break: break-all;">${error.message}</code>
                </div>
                <p style="color: #666; font-size: 14px;">
                    Please check the browser console for more details and ensure all data files are available.
                </p>
            </div>
        `;
    });
}
