import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import ndarray from 'ndarray';
import noUiSlider from 'nouislider';
import npyjs from 'npyjs';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { evaluate_cmap } from "./colormap.js";
import * as d3 from 'd3';

const EPS = 1e-12;
const axis_labels = [
    'x',
    'ξ',
    't',
    'Q\u00b2' // unicode superscript 2
];
let chosen_vars = [0, 3]        // x, Q2
let remaining_vars = [1, 2];    // ξ, t
let control_index = [0, 0];
let data_files = [
    { name: "x values (x.npy)", path: "data/x.npy", key: 'x', type: 'npy' },
    { name: "ξ values (xi.npy)", path: "data/xi.npy", key: 'xi', type: 'npy' },
    { name: "t values (t.npy)", path: "data/t.npy", key: 't', type: 'npy' },
    { name: "Q² values (Q2.npy)", path: "data/Q2.npy", key: 'Q2', type: 'npy' },
    { name: "GPD data (gpd_4d.npy)", path: "data/gpd_4d.npy", key: 'gpd_4d', type: 'npy' },
];
let multi_surface_active = null; // null, 0, or 1
let start_slider_at_middle = false;
let slider_changed = true;
let updated_axis = true;

let upload_overlay = document.getElementById('data-upload-overlay');
let loading_overlay = document.getElementById('loading-overlay');
let main_content = document.getElementById('main-content');

const dropdown1 = document.getElementById('dropdown1');
const dropdown2 = document.getElementById('dropdown2');
const slider1 = document.getElementById('slider1');
const slider2 = document.getElementById('slider2');

const multi_surface_btn1 = document.getElementById('multi-surface1');
const multi_surface_btn2 = document.getElementById('multi-surface2');
const num_surfaces_input = document.getElementById('num-surfaces-input');
let num_surfaces = 10;

const play_slider_btn1 = document.getElementById('play-slider1');
const play_slider_btn2 = document.getElementById('play-slider2');

let is_2d_view = false;
const toggle_view_btn = document.getElementById('toggle-view-btn');
const reset_view_btn = document.getElementById('reset-view-btn');
const range_toggle_btn = document.getElementById('range-toggle-btn');
const bg_dropdown_menu = document.getElementById('bg-dropdown-menu');
const bg_dropdown_toggle = document.getElementById('bg-dropdown-toggle');
let current_background = '#52576e';
const colormap_select = document.getElementById('colormap-select');

const colorbar_container = document.getElementById('colorbar-container');
const three_container = document.getElementById("three-container");
const heatmap_container = document.getElementById('heatmap-container');


// Only allow diverging colormaps for single colormap
let diverging_colormaps = ['coolwarm', 'RdBu', 'Spectral', 'PiYG', 'PRGn', 'BrBG', 'PuOr', 'RdGy', 'RdYlBu', 'RdYlGn'];
let current_colormap = 'coolwarm';

// Initialize toggleViewBtn text based on is2DView
if (toggle_view_btn) {
    toggle_view_btn.innerHTML = is_2d_view
        ? '<i class="fas fa-globe me-1"></i>3D View'
        : '<i class="fas fa-map me-1"></i>2D Heatmap';
}

// Restrict colormapSelect to diverging colormaps only
if (colormap_select) {
    colormap_select.innerHTML = '';
    diverging_colormaps.forEach(cmap => {
        let opt = document.createElement('option');
        opt.value = cmap;
        opt.textContent = cmap;
        colormap_select.appendChild(opt);
    });
    colormap_select.value = current_colormap;
}

// helper to update custom dropdown toggle label and swatch
function updateBackgroundToggle(color, label) {
    if (!bg_dropdown_toggle) return;
    const swatch = bg_dropdown_toggle.querySelector('.bg-swatch');
    const text = bg_dropdown_toggle.querySelector('span.ms-2');
    if (swatch) swatch.style.background = color;
    if (text) text.textContent = label;
}

// --- Data Upload Handling ---
window.addEventListener('DOMContentLoaded', () => {
    document.body.style.overflow = 'hidden';
    const upload_form = document.getElementById('data-upload-form');
    const skipBtn = document.getElementById('skip-upload-btn');

    skipBtn.addEventListener('click', () => {
        upload_overlay.style.display = 'none';
        document.body.style.overflow = '';
        gpdVis();
    });

    upload_form.addEventListener('submit', async (e) => {
        e.preventDefault();
        upload_overlay.style.display = 'none';
        document.body.style.overflow = '';
        const x_file = document.getElementById('file-x').files[0];
        const xi_file = document.getElementById('file-xi').files[0];
        const t_file = document.getElementById('file-t').files[0];
        const q2_file = document.getElementById('file-Q2').files[0];
        const gpd4d_file = document.getElementById('file-gpd4d').files[0];
        if (!(x_file && xi_file && t_file && q2_file && gpd4d_file)) {
            alert('Please select all required files.');
            return;
        }

        // Helper function to determine file type from filename
        function getFileType(filename) {
            const extension = filename.toLowerCase().split('.').pop();
            return extension === 'npy' ? 'npy' : 'bin';
        }

        const x_url = URL.createObjectURL(x_file);
        const xi_url = URL.createObjectURL(xi_file);
        const t_url = URL.createObjectURL(t_file);
        const q2_url = URL.createObjectURL(q2_file);
        const gpd4d_url = URL.createObjectURL(gpd4d_file);

        // Update paths and file types based on uploaded files
        data_files[0].path = x_url;
        data_files[0].type = getFileType(x_file.name);
        data_files[1].path = xi_url;
        data_files[1].type = getFileType(xi_file.name);
        data_files[2].path = t_url;
        data_files[2].type = getFileType(t_file.name);
        data_files[3].path = q2_url;
        data_files[3].type = getFileType(q2_file.name);
        data_files[4].path = gpd4d_url;
        data_files[4].type = getFileType(gpd4d_file.name);

        console.log("Updated dataFiles types:", data_files.map(f => ({ key: f.key, type: f.type })));

        gpdVis();
    });

    // Ensure background selectors are populated after DOM is ready as well
    if (heatmap_container) {
        heatmap_container.style.background = current_background;
    }
});

function loadArray(url) {
    return fetch(url).then(response => {
        if (!response.ok) {
            throw new Error(`Failed to load ${url}, status: ${response.status}`);
        }
        return response.arrayBuffer();
    });
}

function loadDataFiles() {
    const loading_text = document.querySelector('#loading-overlay .loading-text');
    function loadFile(path, type) {
        if (path) {
            const npy = new npyjs();
            if (type === 'npy') {
                return npy.load(path).then(obj => {
                    return new Float64Array(Array.from(obj.data));
                });
            }
            else {
                return loadArray(path);
            }
        }
    }

    const results = [];
    for (const file of data_files) {
        if (loading_text) {
            loading_text.textContent = `Loading ${file.name}...`;
        }
        results.push(loadFile(file.path, file.type));
    }
    return results;
}

function gpdVis() {
    let renderer, scene, min_gpd = Number.MAX_VALUE, max_gpd = Number.MIN_VALUE;
    let base_color = 'white';
    let use_local_range = false;
    
    Promise.all(loadDataFiles())
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
        colormap_select.value = current_colormap;
        
        var x_xi_t_Q2_array = [x, xi, t, Q2];
        let dims = [x.length, xi.length, t.length, Q2.length];
        let gpd_4d = new ndarray(gpd_4d_flat, dims);
        [min_gpd, max_gpd] = getExtrema(gpd_4d_flat);
        let current_range = [min_gpd, max_gpd];
        let camera_3d_state = {};
    
        console.log("min_gpd:", min_gpd, "max_gpd:", max_gpd);
    
        // update the colorbar labels:
        document.querySelectorAll('.colorbar-labels')[0].textContent = `${max_gpd.toFixed(3)}`;
        document.querySelectorAll('.colorbar-labels')[1].textContent = `${min_gpd.toFixed(3)}`;
    
        let camera = new THREE.PerspectiveCamera(75, three_container.clientWidth / three_container.clientHeight, 0.1, 1000);
        camera.position.set(0.147, -0.898, 0.165);
        camera.quaternion.set(0.658, -0.102, -0.070, 0.743);
        camera.up.set(-0.094, -0.145, 0.985);
    
        renderer = new THREE.WebGLRenderer({antialias:true});
        renderer.setClearColor(current_background);
        renderer.setSize( three_container.clientWidth, three_container.clientHeight );
        three_container.appendChild(renderer.domElement);

        let controls = new TrackballControls(camera, renderer.domElement);
        controls.rotateSpeed = 3.0;
        controls.zoomSpeed = 1.0;
    
        let min_axis1, max_axis1, min_axis2, max_axis2;
        let arrays1 = [[], []];
        let arrays2 = [[], []];
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

        function applyBackground(color) {
            current_background = color;
            if (renderer) renderer.setClearColor(color);
            if (heatmap_container) heatmap_container.style.background = color;
            // Set text color for heatmap and colorbar labels
            const isWhite = color.toLowerCase() === '#f8fafc' || color.toLowerCase().includes('white');
            base_color = isWhite ? 'black' : 'white';
            if (heatmap_container) {
                const svg = heatmap_container.querySelector('svg');
                if (svg) {
                    svg.querySelectorAll('text').forEach(el => el.style.fill = base_color);
                    svg.querySelectorAll('line').forEach(el => el.style.stroke = base_color);
                }
            }
            if (colorbar_container) {
                colorbar_container.querySelectorAll('.colorbar-labels, .colorbar-tick-label').forEach(el => el.style.color = base_color);
                colorbar_container.querySelectorAll('.colorbar-tick').forEach(el => el.style.backgroundColor = base_color);
            }
            if (scene) {
                drawAxisTicks(scene, 'z', current_range[0], current_range[1], 4, [min_axis1, max_axis1], [min_axis2, max_axis2]);
            }
        }

        function create_axis_label(text, color) {
            const canvas = document.createElement('canvas');
            const size = 512; // higher resolution for crisp text
            canvas.width = size;
            canvas.height = size;
            const context = canvas.getContext('2d');
            context.clearRect(0, 0, size, size);
            context.font = 'bold 180px Arial';
            context.fillStyle = color;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(text, size / 2, size / 2);
            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;
            const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
            const sprite = new THREE.Sprite(material);
            return sprite;
        }

        function create_axis_line(start, end, width, color){
            const geometry = new LineSegmentsGeometry().setPositions([start.x, start.y, start.z, end.x, end.y, end.z]);
            const material = new LineMaterial({
                color: color,
                linewidth: width
            });
            return new LineSegments2(geometry, material);
        }

        function create_axis_with_labels(center, width=10.0, scale=0.5, labelx="x", labely="y", labelz="z", colorx='#06b6d4', colory='#f59e0b', colorz='#8b5cf6', z_centered = false, label_scale = 0.3, label_offset = 0.1, x_range = [0,1], y_range = [0,1]) {
            let x_start = (0 - x_range[0]) / (x_range[1] - x_range[0]);
            let y_start = (0 - y_range[0]) / (y_range[1] - y_range[0]);

            let x_axis = create_axis_line(new THREE.Vector3(0, y_start, 0), new THREE.Vector3(1, y_start, 0), width, colorx)
            let y_axis = create_axis_line(new THREE.Vector3(x_start, 0, 0), new THREE.Vector3(x_start, 1, 0), width, colory)
            
            let z_axis;
            if (z_centered) {
                z_axis = create_axis_line(new THREE.Vector3(x_start, y_start, -scale/2), new THREE.Vector3(x_start, y_start, scale/2), width, colorz)
            } else {
                z_axis = create_axis_line(new THREE.Vector3(x_start, y_start, 0), new THREE.Vector3(x_start, y_start, scale), width, colorz)
            }
        
            let x_label = create_axis_label(labelx, colorx)
            let y_label = create_axis_label(labely, colory)
            let z_label = create_axis_label(labelz, colorz)
        
            x_label.position.set(1 + label_offset, y_start, 0);
            y_label.position.set(x_start, 1 + label_offset, 0);
        
            if (z_centered) {
                z_label.position.set(x_start, y_start, center.z + scale/2 + label_offset);
            } else {
                z_label.position.set(x_start, y_start, center.z + scale + label_offset);
            }
            
            x_label.scale.set(label_scale, label_scale, label_scale);
            y_label.scale.set(label_scale, label_scale, label_scale);
            z_label.scale.set(label_scale, label_scale, label_scale);
        
            return [x_axis, y_axis, z_axis, x_label, y_label, z_label];
        }

        function drawZAxis(scene, minVal, maxVal, x_range = [0,1], y_range = [0,1]) {
            // Remove previous z-axis line and label
            if (scene.__zAxisLine) {
                scene.remove(scene.__zAxisLine);
                scene.__zAxisLine = null;
            }
            if (scene.__zAxisLabel) {
                scene.remove(scene.__zAxisLabel);
                scene.__zAxisLabel = null;
            }
            const z_start = -0.5;
            const z_end = 0.5;
            const x_pos = (0 - x_range[0]) / (x_range[1] - x_range[0]);
            const y_pos = (0 - y_range[0]) / (y_range[1] - y_range[0]);
            let z_axis_start = z_start, z_axis_end = z_end;
            let label_pos = z_axis_end + 0.07;
            
            if (minVal >= -EPS) {
                z_axis_start = 0;
            }
            else if (maxVal <= EPS) {
                z_axis_end = 0;
                label_pos = z_axis_start - 0.07;
            }
            // Draw z-axis line
            const axis_geometry = new LineSegmentsGeometry().setPositions([
                x_pos, y_pos, z_axis_start,
                x_pos, y_pos, z_axis_end
            ]);
            const axis_material = new LineMaterial({ color: '#8b5cf6', linewidth: 3.0 });
            const axis_line = new LineSegments2(axis_geometry, axis_material);
            scene.add(axis_line);
            scene.__zAxisLine = axis_line;
            // Draw z-axis label
            const label = create_axis_label('GPD', '#8b5cf6');
            label.position.set(x_pos, y_pos, label_pos);
            label.scale.set(0.1, 0.1, 0.1);
            scene.add(label);
            scene.__zAxisLabel = label;
            
            return [z_axis_start, z_axis_end];
        }

        function valueToZ(val, min_val, max_val, z_start = -0.5, z_end = 0.5) {
            if (min_val >= 0) {
                // Axis starts at zero, zStart = 0
                return (max_val === 0) ? z_start : z_start + (z_end - z_start) * (val / (max_val || 1));
            } else if (max_val <= 0) {
                // Axis ends at zero, zEnd = 0
                return (min_val === 0) ? z_end : z_start + (z_end - z_start) * (val / (min_val || 1));
            } else {
                // Axis crosses zero
                return z_start + (z_end - z_start) * ((val - min_val) / (max_val - min_val));
            }
        }

        function drawAxisTicks(scene, axis, min_val, max_val, num_ticks = 4, x_range = [min_axis1, max_axis1], y_range = [min_axis2, max_axis2]) {
            // Remove previous ticks and labels for the given axis
            const tick_group = scene.getObjectByName(`${axis}_tick_group`);
            if (tick_group) {
                // dispose of all children
                tick_group.children.forEach(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (child.material.map) child.material.map.dispose();
                        child.material.dispose();
                    }
                });
                scene.remove(tick_group);
            }
        
            const new_tick_group = new THREE.Group();
            new_tick_group.name = `${axis}_tick_group`;
            scene.add(new_tick_group);

            let tick_values = [];
            if (min_val === max_val) {
                tick_values = [min_val];
            } else if ((axis === 'x' || axis === 'z') && min_val <= 0 && max_val >= 0) {
                // Always include zero, then positive and negative ticks for x-axis and z-axis
                tick_values.push(0);
                for (let i = 1; i <= num_ticks; i++) {
                    tick_values.push(i * max_val / num_ticks);
                    tick_values.push(i * min_val / num_ticks);
                }
            } else {
                for (let i = 0; i <= num_ticks; i++) {
                    tick_values.push(min_val + (max_val - min_val) * (i / num_ticks));
                }
            }
            tick_values = Array.from(new Set(tick_values)).sort((a, b) => a - b);
        
            const [z_axis_start, z_axis_end] = (axis === 'z') ? drawZAxis(scene, min_val, max_val, x_range, y_range) : [0, 0];

            const range = max_val - min_val;

            tick_values.forEach(value => {
                let tick_vertices;
                let label_align = { center: { x: 0.5, y: 0.5 } };
                const label_text = value.toFixed(2);
                const label_color = base_color;
                const label = create_axis_label(label_text, label_color);

                if (axis === 'x') {
                    const x_pos = (value - min_val) / range;
                    const y_pos = (0 - y_range[0]) / (y_range[1] - y_range[0]);
                    label.position.set(x_pos, y_pos - 0.03, 0);
                    tick_vertices = [
                        new THREE.Vector3(x_pos, y_pos, 0),
                        new THREE.Vector3(x_pos, y_pos - 0.02, 0)
                    ];
                } else if (axis === 'y') {
                    const y_pos = (value - min_val) / range;
                    const x_pos = (0 - x_range[0]) / (x_range[1] - x_range[0]);
                    label.position.set(x_pos - 0.03, y_pos, 0);
                    tick_vertices = [
                        new THREE.Vector3(x_pos, y_pos, 0),
                        new THREE.Vector3(x_pos - 0.02, y_pos, 0)
                    ];
                } else { // z-axis
                    const z = valueToZ(value, min_val, max_val, z_axis_start, z_axis_end);
                    const x_pos = (0 - x_range[0]) / (x_range[1] - x_range[0]);
                    const y_pos = (0 - y_range[0]) / (y_range[1] - y_range[0]);
                    label.position.set(x_pos - 0.03, y_pos, z);
                    tick_vertices = [
                        new THREE.Vector3(x_pos, y_pos, z),
                        new THREE.Vector3(x_pos - 0.02, y_pos, z)
                    ];
                }
        
                // Tick mark
                const tick_geometry = new THREE.BufferGeometry().setFromPoints(tick_vertices);
                const tick_material = new THREE.LineBasicMaterial({ color: label_color });
                const tick_line = new THREE.Line(tick_geometry, tick_material);
                new_tick_group.add(tick_line);
        
                // Tick label
                if ((axis === 'x' || axis === 'y') && Math.abs(value) < 1e-9) {
                } else {
                    if (label_align.center) {
                        label.center.set(label_align.center.x, label_align.center.y);
                    }
                    label.scale.set(0.05, 0.05, 0.05);
                    new_tick_group.add(label);
                }
            });
        }

        function getExtrema(arr){
            let maxv = Number.MIN_VALUE;
            let minv = Number.MAX_VALUE;
            arr.forEach(val => {
                maxv = Math.max(maxv, val)
                minv = Math.min(minv, val)
            })
            return [minv, maxv];
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
            const scene_info = document.getElementById('scene-info');
            if (scene_info) {
                scene_info.textContent = message;
            }
        }

        // Update slider labels to show remaining variables
        function updateSliderLabels() {
            remaining_vars = [0, 1, 2, 3].filter(i => !chosen_vars.includes(i));
            document.getElementById('slider1-label').textContent = axis_labels[remaining_vars[0]] + ': ';
            document.getElementById('slider2-label').textContent = axis_labels[remaining_vars[1]] + ': ';
        }

        // Update colorbar min/max labels and gradient for the single colorbar
        function updateColorbar(min, max, colormap) {
            const labels = colorbar_container.querySelectorAll('.colorbar-labels');
            if (labels.length >= 2) {
                labels[0].textContent = max.toFixed(3);
                labels[1].textContent = min.toFixed(3);
            }
            
            // Clear existing intermediate ticks and labels
            const existing_ticks = colorbar_container.querySelectorAll('.colorbar-tick, .colorbar-tick-label');
            existing_ticks.forEach(tick => tick.remove());
            
            const colorbar = colorbar_container.querySelector('.colorbar');
            if (colorbar) {
                let stops = [];
                for (let i = 0; i <= 100; i += 10) {
                    const value = i / 100;
                    let rgb = evaluate_cmap(value, colormap, false);
                    if (!rgb || rgb.length !== 3) {
                        rgb = [255, 255, 255];
                    }
                    stops.push(`rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])}) ${i}%`);
                }
                colorbar.style.background = `linear-gradient(to top, ${stops.join(', ')})`;
                
                // Add intermediate ticks (excluding min and max which are already handled)
                const num_ticks = 5; // Number of intermediate ticks
                for (let i = 1; i <= num_ticks; i++) {
                    const fraction = i / (num_ticks + 1);
                    const value = min + (max - min) * fraction;
                    const position = fraction * 100;
                    
                    // Create tick mark 
                    const tick = document.createElement('div');
                    tick.className = 'colorbar-tick';
                    tick.style.position = 'absolute';
                    tick.style.right = '75%';
                    tick.style.bottom = `${position}%`;
                    tick.style.width = '8px';
                    tick.style.height = '1px';
                    tick.style.backgroundColor = 'white';
                    tick.style.transform = 'translateY(50%)';
                    
                    // Create tick label
                    const tickLabel = document.createElement('div');
                    tickLabel.className = 'colorbar-tick-label';
                    tickLabel.style.position = 'absolute';
                    tickLabel.style.right = '105%';
                    tickLabel.style.bottom = `${position}%`;
                    tickLabel.style.color = 'white';
                    tickLabel.style.fontSize = '10px';
                    tickLabel.style.transform = 'translateY(50%)';
                    tickLabel.style.whiteSpace = 'nowrap';
                    tickLabel.style.textAlign = 'right';
                    tickLabel.textContent = value.toFixed(3);
                    
                    colorbar.appendChild(tick);
                    colorbar.appendChild(tickLabel);
                }
            }
        }

        // Move colorbar-container to correct parent on view switch
        function moveColorbarToCurrentView() {
            if (is_2d_view) {
                heatmap_container.appendChild(colorbar_container);
            } else {
                three_container.appendChild(colorbar_container);
            }
        }


        // Helper to draw D3 heatmap for current 2D slice
        function drawHeatmap() {
            heatmap_container.innerHTML = '';
            heatmap_container.style.background = current_background;
            const axis1 = chosen_vars[0];
            const axis2 = chosen_vars[1];
            const arr1 = x_xi_t_Q2_array[axis1];
            const arr2 = x_xi_t_Q2_array[axis2];
            const target_grid_size = 20;
            // const targetGridSize = Math.min(arr1.length, arr2.length);
            
            // Helper function for linear interpolation
            function interpolateValue(target_index, source_length, target_length) {
                const ratio = (source_length - 1) / (target_length - 1);
                const exact_index = target_index * ratio;
                const lower_index = Math.floor(exact_index);
                const upper_index = Math.min(lower_index + 1, source_length - 1);
                const fraction = exact_index - lower_index;
                return { lower_index: lower_index, upper_index: upper_index, fraction };
            }
            
            // Prepare 2D data slice for D3 with interpolation
            const slice = [];
            for (let j = 0; j < target_grid_size; j++) {
                for (let i = 0; i < target_grid_size; i++) {
                    let query_index = [0, 0, 0, 0];
                    
                    // Handle interpolation for axis1
                    let axis1_indices;
                    if (arr1.length === target_grid_size) {
                        axis1_indices = { lower_index: i, upper_index: i, fraction: 0 };
                    } else {
                        axis1_indices = interpolateValue(i, arr1.length, target_grid_size);
                    }
                    
                    // Handle interpolation for axis2
                    let axis2_indices;
                    if (arr2.length === target_grid_size) {
                        axis2_indices = { lower_index: j, upper_index: j, fraction: 0 };
                    } else {
                        axis2_indices = interpolateValue(j, arr2.length, target_grid_size);
                    }
                    
                    // Bilinear interpolation for GPD values
                    let interpolated_value;
                    if (axis1_indices.fraction === 0 && axis2_indices.fraction === 0) {
                        // No interpolation needed
                        query_index[axis1] = axis1_indices.lower_index;
                        query_index[axis2] = axis2_indices.lower_index;
                        query_index[remaining_vars[0]] = control_index[0];
                        query_index[remaining_vars[1]] = control_index[1];
                        interpolated_value = gpd_4d.get(query_index[0], query_index[1], query_index[2], query_index[3]);
                    } else {
                        // Bilinear interpolation
                        const values = [];
                        const indices = [
                            [axis1_indices.lower_index, axis2_indices.lower_index],
                            [axis1_indices.upper_index, axis2_indices.lower_index],
                            [axis1_indices.lower_index, axis2_indices.upper_index],
                            [axis1_indices.upper_index, axis2_indices.upper_index]
                        ];
                        
                        for (let [idx1, idx2] of indices) {
                            query_index[axis1] = idx1;
                            query_index[axis2] = idx2;
                            query_index[remaining_vars[0]] = control_index[0];
                            query_index[remaining_vars[1]] = control_index[1];
                            values.push(gpd_4d.get(query_index[0], query_index[1], query_index[2], query_index[3]));
                        }
                        
                        // Bilinear interpolation formula
                        const v1 = values[0] * (1 - axis1_indices.fraction) + values[1] * axis1_indices.fraction;
                        const v2 = values[2] * (1 - axis1_indices.fraction) + values[3] * axis1_indices.fraction;
                        interpolated_value = v1 * (1 - axis2_indices.fraction) + v2 * axis2_indices.fraction;
                    }
                    
                    slice.push({
                        i: i,
                        j: j,
                        value: interpolated_value
                    });
                }
            }
            
            // Calculate square dimensions
            const margin = {top: 30, right: 50, bottom: 30, left: 30};
            const container_width = heatmap_container.clientWidth - margin.left - margin.right;
            const container_height = heatmap_container.clientHeight - margin.top - margin.bottom;
            const square_size = Math.min(container_width, container_height);
            
            // Calculate horizontal centering offset
            const total_svg_width = heatmap_container.clientWidth;
            const square_with_margins = square_size + margin.left + margin.right;
            const horizontal_offset = (total_svg_width - square_with_margins) / 2;
            
            const svg = d3.select(heatmap_container)
                .append('svg')
                .attr('width', total_svg_width)
                .attr('height', square_size + margin.top + margin.bottom)
                .style('display', 'block')
                .append('g')
                .attr('transform', `translate(${margin.left + horizontal_offset},${margin.top})`);
            
            // Create tooltip
            const tooltip = d3.select(heatmap_container)
                .append('div')
                .style('opacity', 0)
                .attr('class', 'heatmap-tooltip')
                .style('position', 'absolute')
                .style('background-color', 'rgba(0, 0, 0, 0.8)')
                .style('color', 'white')
                .style('border', 'solid')
                .style('border-width', '1px')
                .style('border-color', '#666')
                .style('border-radius', '5px')
                .style('padding', '8px')
                .style('font-size', '12px')
                .style('pointer-events', 'none')
                .style('z-index', '1000');
            
            // Build X and Y scales
            const x_scale = axis1 === 1 ? d3.scaleLog() : d3.scaleLinear();
            x_scale.domain(d3.extent(arr1)).range([0, square_size]);

            const y_scale = axis2 === 1 ? d3.scaleLog() : d3.scaleLinear();
            y_scale.domain(d3.extent(arr2)).range([square_size, 0]);

            // Create interpolated arrays for cell boundaries
            const arr1_interpolated = Array.from({length: target_grid_size + 1}, (_, i) => {
                const { lower_index, upper_index, fraction } = interpolateValue(i, arr1.length, target_grid_size);
                return arr1[lower_index] * (1 - fraction) + arr1[upper_index] * fraction;
            });
            const arr2_interpolated = Array.from({length: target_grid_size + 1}, (_, j) => {
                const { lower_index, upper_index, fraction } = interpolateValue(j, arr2.length, target_grid_size);
                return arr2[lower_index] * (1 - fraction) + arr2[upper_index] * fraction;
            });
            
            // Tooltip event handlers
            const mouseover = function(event, d) {
                tooltip.style('opacity', 1);
            };
            
            const mousemove = function(event, d) {
                const container_rect = heatmap_container.getBoundingClientRect();
                const mouseX = event.clientX - container_rect.left;
                const mouseY = event.clientY - container_rect.top;
                const tooltip_offset = 10;
                
                // Set initial position close to mouse
                let tooltipX = mouseX + tooltip_offset;
                let tooltipY = mouseY + tooltip_offset;
                
                // Get tooltip dimensions (temporarily show it to measure)
                tooltip.style('opacity', 1)
                    .html(`<strong>GPD Value:</strong> ${d.value.toFixed(6)}`);
                
                const tooltip_node = tooltip.node();
                const tooltip_width = tooltip_node.offsetWidth;
                const tooltip_height = tooltip_node.offsetHeight;
                
                // Edge detection - adjust position if tooltip would go off-screen
                if (tooltipX + tooltip_width > heatmap_container.clientWidth) {
                    tooltipX = mouseX - tooltip_width - tooltip_offset; // Show to the left of cursor
                }
                if (tooltipY + tooltip_height > heatmap_container.clientHeight) {
                    tooltipY = mouseY - tooltip_height - tooltip_offset; // Show above cursor
                }
                
                // Ensure tooltip doesn't go beyond container bounds
                tooltipX = Math.max(0, Math.min(tooltipX, heatmap_container.clientWidth - tooltip_width));
                tooltipY = Math.max(0, Math.min(tooltipY, heatmap_container.clientHeight - tooltip_height));
                
                tooltip
                    .style('left', tooltipX + 'px')
                    .style('top', tooltipY + 'px');
            };
            
            const mouseleave = function(event, d) {
                tooltip.style('opacity', 0);
            };
            
            // Draw squares
            svg.selectAll('rect')
                .data(slice)
                .join('rect')
                .attr('x', d => x_scale(arr1_interpolated[d.i]))
                .attr('y', d => Math.min(y_scale(arr2_interpolated[d.j]), y_scale(arr2_interpolated[d.j + 1])))
                .attr('width', d => x_scale(arr1_interpolated[d.i + 1]) - x_scale(arr1_interpolated[d.i]))
                .attr('height', d => Math.abs(y_scale(arr2_interpolated[d.j]) - y_scale(arr2_interpolated[d.j + 1])))
                .style('fill', d => {
                    const normalized_value = (d.value - current_range[0]) / (current_range[1] - current_range[0]);
                    const rgb = evaluate_cmap(normalized_value, current_colormap, false);
                    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
                })
                .style('stroke', 'none') 
                .style('stroke-width', 0)
                .style('cursor', 'pointer')
                .on('mouseover', mouseover)
                .on('mousemove', mousemove)
                .on('mouseleave', mouseleave);
            
            // Add X axis
            const x_axis = d3.axisBottom(x_scale).ticks(5);
            svg.append("g")
                .attr("transform", `translate(0,${square_size})`)
                .call(x_axis)
                .selectAll("text")
                .style("fill", "white");
            svg.selectAll(".tick line").attr("stroke", "white");
            svg.selectAll(".domain").attr("stroke", "white");

            // Add Y axis
            const y_axis = d3.axisLeft(y_scale).ticks(5);
            svg.append("g")
                .call(y_axis)
                .selectAll("text")
                .style("fill", "white");
            svg.selectAll(".tick line").attr("stroke", "white");
            svg.selectAll(".domain").attr("stroke", "white");

            // Axis labels
            svg.append('text')
                .attr('x', square_size + 10)
                .attr('y', square_size + 15)
                .attr('text-anchor', 'start')
                .attr('font-size', '20px')
                .attr('font-weight', 'bold')
                .attr('fill', 'white')
                .text(axis_labels[axis1]);
            svg.append('text')
                .attr('x', -10)
                .attr('y', -5)
                .attr('text-anchor', 'end')
                .attr('font-size', '20px')
                .attr('font-weight', 'bold')
                .attr('fill', 'white')
                .text(axis_labels[axis2]);

            if (!heatmap_container.contains(colorbar_container)) {
                heatmap_container.appendChild(colorbar_container);
            }
        }

        function updateCurrentRange() {
            if (use_local_range) {
                let curMin = Number.MAX_VALUE, curMax = Number.MIN_VALUE;
                for (let j = 0; j < x_xi_t_Q2_array[chosen_vars[1]].length; j++) {
                    for (let i = 0; i < x_xi_t_Q2_array[chosen_vars[0]].length; i++) {
                        let query_index = [0, 0, 0, 0];
                        query_index[chosen_vars[0]] = i;
                        query_index[chosen_vars[1]] = j;
                        query_index[remaining_vars[0]] = control_index[0];
                        query_index[remaining_vars[1]] = control_index[1];
                        let gpd_val = gpd_4d.get(query_index[0], query_index[1], query_index[2], query_index[3]);
                        if (gpd_val < curMin) curMin = gpd_val;
                        if (gpd_val > curMax) curMax = gpd_val;
                    }
                }
                // Make range symmetric around the zero value
                const max_abs_value = Math.max(Math.abs(curMin), Math.abs(curMax));
                current_range = [-max_abs_value, max_abs_value];
            } else {
                current_range = [min_gpd, max_gpd];
            }
        }

        // Toggle between Three.js and D3 heatmap
        function updateViewMode() {
            if (is_2d_view) {
                three_container.style.display = 'none';
                heatmap_container.style.display = 'block';
                heatmap_container.style.background = current_background;
                drawHeatmap();
                // Disable multi-surface controls in 2D view
                if (multi_surface_btn1) multi_surface_btn1.disabled = true;
                if (multi_surface_btn2) multi_surface_btn2.disabled = true;
                if (num_surfaces_input) num_surfaces_input.disabled = true;
            } else {
                three_container.style.display = 'block';
                heatmap_container.style.display = 'none';
                if (renderer) renderer.setClearColor(current_background);
                // Enable multi-surface controls in 3D view
                if (multi_surface_btn1) multi_surface_btn1.disabled = false;
                if (multi_surface_btn2) multi_surface_btn2.disabled = false;
                if (num_surfaces_input) num_surfaces_input.disabled = false;
                // Force resize the renderer after switching to 3D view
                setTimeout(() => {
                    if (camera && renderer) {
                        camera.aspect = three_container.clientWidth / three_container.clientHeight;
                        camera.updateProjectionMatrix();
                        renderer.setSize(three_container.clientWidth, three_container.clientHeight);
                    }
                }, 0);
            }
            // Update colorbar to correct range
            updateColorbar(current_range[0], current_range[1], current_colormap);
            applyBackground(current_background);
            moveColorbarToCurrentView();
        }

        function animateSlider(slider, dataArray, idx, playBtn, playingFlag, intervalVar) {
            if (use_local_range) {
                showNotification('Animation can only play in global range.', 'warning');
                return;
            }
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
                updateColorbar(min_gpd, max_gpd, current_colormap);

                // Show multiple surfaces if multi-surface mode is active
                if (multi_surface_active === idx) {
                    showMultipleSurfaces(idx);
                }
                
                // Update 2D heatmap if in 2D view mode
                if (is_2d_view) {
                    drawHeatmap();
                }
            }, 200);
        }

        // Standalone function to render the 3D scene
        function render3DScene() {
            // Main scene rendering
            renderer.setViewport(0, 0, three_container.clientWidth, three_container.clientHeight);
            controls.update();
            renderer.clear();
            renderer.render(scene, camera);
    
            // Axis orientation guide rendering
            axis_camera.quaternion.copy(camera.quaternion);
            renderer.clearDepth();  
            renderer.autoClear = false;
            renderer.setViewport(0, 0, 200, 200);
            renderer.render(axis_scene, axis_camera);
        }

        function animate() {
            if (updated_axis) {
                updated_axis = false;
    
                arrays1 = [x_xi_t_Q2_array[chosen_vars[0]], x_xi_t_Q2_array[chosen_vars[1]]];   // axes
                arrays2 = [x_xi_t_Q2_array[remaining_vars[0]], x_xi_t_Q2_array[remaining_vars[1]]]; // sliders
    
                [min_axis1, max_axis1] = getExtrema(arrays1[0]);
                [min_axis2, max_axis2] = getExtrema(arrays1[1]);
    
                slider1.noUiSlider.updateOptions({
                    range: {
                        min: 0,
                        max: arrays2[0].length - 1
                    },
                    tooltips: { 
                        to: function (value) { return arrays2[0][Math.round(value)]; } 
                    },
                });
    
                slider2.noUiSlider.updateOptions({
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
                // Only create x and y axes and their labels for global_axis
                let [x_axis, y_axis, , x_label, y_label, ] = create_axis_with_labels(
                    new THREE.Vector3(0, 0, 0),
                    3.0, 1.0,
                    axis_labels[chosen_vars[0]],
                    axis_labels[chosen_vars[1]],
                    "GPD",
                    '#06b6d4', '#f59e0b', '#8b5cf6', true, 0.2, 0.05, [min_axis1, max_axis1], [min_axis2, max_axis2]
                );
                scene.add(x_axis);
                scene.add(y_axis);
                scene.add(x_label);
                scene.add(y_label);
                scene.add(plane);

                // Add a reference plane to show where GPD=0 is
                let referencePlaneGeometry = new THREE.PlaneGeometry(1, 1);
                let referencePlaneMaterial = new THREE.MeshBasicMaterial({
                    color: 0xaaaaaa,
                    transparent: true,
                    opacity: 0.5,
                    side: THREE.DoubleSide,
                    // polygonOffset: true,
                    // polygonOffsetFactor: -1.0,
                    // polygonOffsetUnits: -4.0
                });
                let referencePlane = new THREE.Mesh(referencePlaneGeometry, referencePlaneMaterial);
                referencePlane.position.set(0.5, 0.5, -0.0001); // Center at the middle of the XY plane
                scene.add(referencePlane);
                
                drawAxisTicks(scene, 'z', current_range[0], current_range[1], 4, [min_axis1, max_axis1], [min_axis2, max_axis2]);
                drawAxisTicks(scene, 'x', min_axis1, max_axis1);
                drawAxisTicks(scene, 'y', min_axis2, max_axis2);
    
                axis_scene = new THREE.Scene();
                let orient_axis = create_axis_with_labels(new THREE.Vector3(0, 0, 0), 5.0, 1.0, axis_labels[chosen_vars[0]], axis_labels[chosen_vars[1]], "GPD", '#06b6d4', '#f59e0b', '#8b5cf6', true, 1.0, 0.2, [min_axis1, max_axis1], [min_axis2, max_axis2]);
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
                controls.target.set(0.5, 0.5, 0);
                controls.update();
            }
    
            if (slider_changed) {
                slider_changed = false;
                let query_index = [0, 0, 0, 0];
                // Get correct zStart/zEnd from drawZAxis
                const [zStart, zEnd] = drawZAxis(scene, current_range[0], current_range[1], [min_axis1, max_axis1], [min_axis2, max_axis2]);

                for (let j = 0; j < arrays1[1].length; j++) {
                    for (let i = 0; i < arrays1[0].length; i++) {
                        query_index[chosen_vars[0]] = i;
                        query_index[chosen_vars[1]] = j;
                        query_index[remaining_vars[0]] = control_index[0];
                        query_index[remaining_vars[1]] = control_index[1];

                        let gpd_val = gpd_4d.get(query_index[0], query_index[1], query_index[2], query_index[3]);
                        // Use valueToZ for correct z position
                        const z = valueToZ(gpd_val, current_range[0], current_range[1], zStart, zEnd);

                        let vertex = geometry.attributes.position;
                        vertex.setZ(j * arrays1[0].length + i, z);

                        let normalized_gpd = (gpd_val - current_range[0]) / (current_range[1] - current_range[0]);
                        let color = evaluate_cmap(normalized_gpd, current_colormap, false);
                        colors[(j * arrays1[0].length + i) * 3] = color[0] / 255.;
                        colors[(j * arrays1[0].length + i) * 3 + 1] = color[1] / 255.;
                        colors[(j * arrays1[0].length + i) * 3 + 2] = color[2] / 255.;
                    }
                }
                geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                positions.needsUpdate = true;
                geometry.computeVertexNormals();
            }
    
            render3DScene();
        }
        renderer.setAnimationLoop( animate );
    
        // Initialize arrays2 for slider setup
        arrays2 = [x_xi_t_Q2_array[remaining_vars[0]], x_xi_t_Q2_array[remaining_vars[1]]];
        if (start_slider_at_middle) {
            const middle0 = Math.floor(arrays2[0].length / 2);
            const middle1 = Math.floor(arrays2[1].length / 2);
            control_index[0] = middle0;
            control_index[1] = middle1;
        }
        else {
            control_index[0] = 0;
            control_index[1] = 0;
        }

        noUiSlider.create(slider1, {
            start: [control_index[0]],
            tooltips: { 
                to: function (value) { return arrays2[0][Math.round(value)]; } 
            },
            step: 1,
            range: {
                min: 0,
                max: arrays2[0].length - 1
            },  
        });

        noUiSlider.create(slider2, {
            start: [control_index[1]],
            tooltips: { 
                to: function (value) { return arrays2[1][Math.round(value)]; } 
            },
            step: 1,
            range: {
                min: 0,
                max: arrays2[1].length - 1
            },
        });
    
        updateSliderLabels();
        updateColorbar(min_gpd, max_gpd, current_colormap);
        updateSceneInfo('Scene ready');
        updateViewMode(); // Ensure correct view is shown on load
    
        function resetView() {
            // Reset main camera
            camera.position.set(0.147, -0.898, 0.165);
            camera.quaternion.set(0.658, -0.102, -0.070, 0.743);
            camera.up.set(-0.094, -0.145, 0.985);
            camera.updateProjectionMatrix();
            controls.target.set(0.5, 0.5, 0);
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
            
            applyBackground(current_background);
            updateSceneInfo('View reset to default');
        }
    
        /* Add event listeners below */
        if (slider1) {
            slider1.noUiSlider.on('change', function(values, handle) {
                control_index[0] = Number(values[0]);
                slider_changed = true;
                if (multi_surface_active === 0) {
                    showMultipleSurfaces(0);
                } else {
                    clearMultiSurface();
                }
                // Update view depending on current mode
                updateCurrentRange();
                if (is_2d_view) {
                    drawHeatmap();
                } else {
                    if (scene) {
                        drawAxisTicks(scene, 'z', current_range[0], current_range[1], 4, [min_axis1, max_axis1], [min_axis2, max_axis2]);
                    }
                }
                updateColorbar(current_range[0], current_range[1], current_colormap);
            });
            // Stop animation if user interacts with slider manually
            slider1.noUiSlider.on('start', function() {
                if (window.slider1Playing) {
                    window.slider1Playing = false;
                    play_slider_btn1.innerHTML = '<i class="fas fa-play"></i>';
                    clearInterval(window.slider1Interval);
                    window.slider1Interval = null;
                }
            });
        }
        if (slider2) {
            slider2.noUiSlider.on('change', function(values, handle) {
                control_index[1] = Number(values[0]);
                slider_changed = true;
                if (multi_surface_active === 1) {
                    showMultipleSurfaces(1);
                } else {
                    clearMultiSurface();
                }
                // Update view depending on current mode
                updateCurrentRange();
                if (is_2d_view) {
                    drawHeatmap();
                } else {
                    if (scene) {
                        drawAxisTicks(scene, 'z', current_range[0], current_range[1], 4, [min_axis1, max_axis1], [min_axis2, max_axis2]);
                    }
                }
                updateColorbar(current_range[0], current_range[1], current_colormap);
            });
            slider2.noUiSlider.on('start', function() {
                if (window.slider2Playing) {
                    window.slider2Playing = false;
                    play_slider_btn2.innerHTML = '<i class="fas fa-play"></i>';
                    clearInterval(window.slider2Interval);
                    window.slider2Interval = null;
                }
            });
        }
    
        if (play_slider_btn1) {
            play_slider_btn1.addEventListener('click', function() {
                animateSlider(slider1, arrays2[0], 0, play_slider_btn1, 'slider1Playing', 'slider1Interval');
            });
        }
        if (play_slider_btn2) {
            play_slider_btn2.addEventListener('click', function() {
                animateSlider(slider2, arrays2[1], 1, play_slider_btn2, 'slider2Playing', 'slider2Interval');
            });
        }
    
        // Helper to stop any animation
        function stopAllAnimations() {
            if (window.slider1Playing) {
                window.slider1Playing = false;
                play_slider_btn1.innerHTML = '<i class="fas fa-play"></i>';
                clearInterval(window.slider1Interval);
                window.slider1Interval = null;
            }
            if (window.slider2Playing) {
                window.slider2Playing = false;
                play_slider_btn2.innerHTML = '<i class="fas fa-play"></i>';
                clearInterval(window.slider2Interval);
                window.slider2Interval = null;
            }
        }
    
        function showMultipleSurfaces(idx) {
            stopAllAnimations();
            multi_surface_active = idx;
            // Toggle button styles
            if (multi_surface_btn1) {
                multi_surface_btn1.classList.toggle('btn-secondary', idx === 0);
                multi_surface_btn1.classList.toggle('btn-outline-secondary', idx !== 0);
            }
            if (multi_surface_btn2) {
                multi_surface_btn2.classList.toggle('btn-secondary', idx === 1);
                multi_surface_btn2.classList.toggle('btn-outline-secondary', idx !== 1);
            }
            const offset = -5;
            const centerIdx = control_index[idx];
            const maxDistance = Math.floor(num_surfaces / 2);
            const surfaces = [];
            for (let i = 0; i < num_surfaces; i++) {
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
                    
                    // Use scaled actual GPD values (same as main surface)
                    let gpd_range = max_gpd - min_gpd;
                    let scale_factor = 2.0 / gpd_range;
                    let z_value = gpd_raw_value * scale_factor;
                    surfacePositions.setZ(j, z_value);
                    let color = evaluate_cmap(gpd_value, current_colormap, false);
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
            multi_surface_active = null;
            if (multi_surface_btn1) {
                multi_surface_btn1.classList.remove('btn-secondary');
                multi_surface_btn1.classList.add('btn-outline-secondary');
            }
            if (multi_surface_btn2) {
                multi_surface_btn2.classList.remove('btn-secondary');
                multi_surface_btn2.classList.add('btn-outline-secondary');
            }
            if (scene && scene.__multiSurfaces) {
                scene.__multiSurfaces.forEach(m => scene.remove(m));
                scene.__multiSurfaces = [];
                renderer.render(scene, camera);
            }
        }
    
        multi_surface_btn1.addEventListener('click', function() {
            if (multi_surface_active === 0) {
                clearMultiSurface();
            } else {
                showMultipleSurfaces(0);
            }
        });
        multi_surface_btn2.addEventListener('click', function() {
            if (multi_surface_active === 1) {
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
                slider1.noUiSlider.set(0);
                slider2.noUiSlider.set(0);
                updateSliderLabels();
                showNotification(`Primary axis changed to ${axis_labels[selectedValue]}.`, "success");
                updateCurrentRange();
                updateColorbar(current_range[0], current_range[1], current_colormap);
                if (is_2d_view) {
                    drawHeatmap();
                }
                controls.target.set(0.5, 0.5, 0);
                controls.update();
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
                slider1.noUiSlider.set(0);
                slider2.noUiSlider.set(0);
                updateSliderLabels();                                            
                showNotification(`Secondary axis changed to ${axis_labels[selectedValue]}.`, "success");
                updateCurrentRange();
                updateColorbar(current_range[0], current_range[1], current_colormap);
                if (is_2d_view) {
                    drawHeatmap();
                }
                controls.target.set(0.5, 0.5, 0);
                controls.update();
            });
        }
    
        if (toggle_view_btn) {
            toggle_view_btn.addEventListener('click', function() {
                is_2d_view = !is_2d_view;
                toggle_view_btn.innerHTML = is_2d_view
                    ? '<i class="fas fa-globe me-1"></i>3D View'
                    : '<i class="fas fa-map me-1"></i>2D Heatmap';
                updateSceneInfo(is_2d_view ? "Switched to 2D heatmap" : "Switched to 3D view");
                updateViewMode();
                if (!is_2d_view) {
                    // Restore 3D camera state
                    if (camera_3d_state.position) {
                        camera.up.copy(camera_3d_state.up);
                        camera.position.copy(camera_3d_state.position);
                        camera.quaternion.copy(camera_3d_state.quaternion);
                        controls.target.copy(camera_3d_state.target);
                    } else {
                        resetView();
                    }
                    controls.noRotate = false;
                    controls.update();
                } else {
                    // Save current 3D camera state
                    camera_3d_state.up = camera.up.clone();
                    camera_3d_state.position = camera.position.clone();
                    camera_3d_state.quaternion = camera.quaternion.clone();
                    camera_3d_state.target = controls.target.clone();
                    controls.noRotate = true;
                }
            });
        }

        if (reset_view_btn) {
            reset_view_btn.addEventListener('click', resetView);
        }

        if (num_surfaces_input) {
            num_surfaces_input.addEventListener('change', function() {
                let val = parseInt(num_surfaces_input.value, 10);
                if (isNaN(val) || val < 1) val = 1;
                if (val > 50) val = 50;
                num_surfaces = val;
                num_surfaces_input.value = val;
                if (multi_surface_active === 0) showMultipleSurfaces(0);
                if (multi_surface_active === 1) showMultipleSurfaces(1);
            });
        }
    
        if (colormap_select) {
            colormap_select.addEventListener('change', function() {
                current_colormap = colormap_select.value;
                updateColorbar(current_range[0], current_range[1], current_colormap);
                if (is_2d_view) {
                    drawHeatmap();
                }
            });
        }

        if (bg_dropdown_menu) {
            bg_dropdown_menu.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-color]');
                if (!btn) return;
                const color = btn.getAttribute('data-color');
                const label = btn.getAttribute('data-label') || '';
                current_background = color;
                applyBackground(current_background);
                updateBackgroundToggle(current_background, label);
            });
        }

        if (range_toggle_btn) {
            range_toggle_btn.addEventListener('click', () => {
                use_local_range = !use_local_range;
                range_toggle_btn.innerHTML = use_local_range
                    ? '<i class="fas fa-chart-line me-1"></i> Local Range'
                    : '<i class="fas fa-chart-line me-1"></i> Global Range';
                
                slider_changed = true;
                updated_axis = true;
                const rangeType = use_local_range ? 'local' : 'global';
                showNotification(`Switched to ${rangeType} range.`, 'info');
                
                updateCurrentRange();
                if (scene) {
                    drawAxisTicks(scene, 'z', current_range[0], current_range[1], 4, [min_axis1, max_axis1], [min_axis2, max_axis2]);
                }
                // Also update colorbar
                updateColorbar(current_range[0], current_range[1], current_colormap);
            });
        }

        window.addEventListener('DOMContentLoaded', () => {
            applyBackground(current_background);
        });

        // Window resize handling
        window.addEventListener('resize', function() {
            camera.aspect = three_container.clientWidth / three_container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(three_container.clientWidth, three_container.clientHeight);
            if (is_2d_view) {
                drawHeatmap();
            }
        });
    
        // Keyboard shortcuts
        window.addEventListener('keydown', function(event) {
            if (event.key === 'c') {
                const pos = camera.position;
                const quat = camera.quaternion;
                const target = controls.target;
                const up = camera.up;
                console.log('// Current camera state:');
                console.log(`camera.position.set(${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)});`);
                console.log(`camera.quaternion.set(${quat.x.toFixed(3)}, ${quat.y.toFixed(3)}, ${quat.z.toFixed(3)}, ${quat.w.toFixed(3)});`);
                console.log(`camera.up.set(${up.x.toFixed(3)}, ${up.y.toFixed(3)}, ${up.z.toFixed(3)});`);
                console.log(`controls.target.set(${target.x.toFixed(3)}, ${target.y.toFixed(3)}, ${target.z.toFixed(3)});`);
                console.log(`camera.zoom.set(${camera.zoom.toFixed(3)});`);
            }
            else if (event.ctrlKey && event.key === 'r') {
                event.preventDefault();
                resetView();
            }
        });
    
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
