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
// let data_files = [
//     { name: "x values", path: "data/x.npy", key: 'x', type: 'npy' },
//     { name: "ξ values", path: "data/xi.npy", key: 'xi', type: 'npy' },
//     { name: "t values", path: "data/t.npy", key: 't', type: 'npy' },
//     { name: "Q² values", path: "data/Q2.npy", key: 'Q2', type: 'npy' },
//     { name: "GPD data", path: "data/gpd_4d.npy", key: 'gpd_4d', type: 'npy' },
// ];
// In production (GitHub Pages), use the hosted dataset URL. In local development, use local file.
const GPD_DATA_PATH = import.meta.env.PROD
    ? "https://huggingface.co/datasets/guoxiliu/GPD-data/resolve/main/gpd_x_xi_t_Q2_r_small_3r.npy"
    : "data_new/gpd_x_xi_t_Q2_r_small.npy";

let data_files = [
    { name: "x values", path: "data_new/x_grid.npy", key: 'x', type: 'npy' },
    { name: "ξ values", path: "data_new/xi_array.npy", key: 'xi', type: 'npy' },
    { name: "t values", path: "data_new/t_array.npy", key: 't', type: 'npy' },
    { name: "Q² values", path: "data_new/Q2_array.npy", key: 'Q2', type: 'npy' },
    { name: "GPD data", path: GPD_DATA_PATH, key: 'gpd_4d', type: 'npy' },
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
const heatmap_method_select = document.getElementById('heatmap-method-select');
const heatmap_controls = document.getElementById('heatmap-controls');
let heatmap_method = 'all_values'; // 'all_values' or 'interpolation'

const zero_plane_select = document.getElementById('zero-plane-select');
let current_zero_plane = zero_plane_select.value; // 'none', 'gray', 'checkerboard', 'wireframe'
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
            loading_text.textContent = `Loading ${file.name} (${file.path})...`;
        }
        results.push(loadFile(file.path, file.type));
    }
    return results;
}

function gpdVis() {
    let renderer, scene, min_gpd = Infinity, max_gpd = -Infinity;
    let base_color = 'white';
    let use_local_range = false;
    
    Promise.all(loadDataFiles())
    .then(([x_grid_flat, xi, t, Q2, gpd_5d_flat]) => {
        
        x_grid_flat = new Float64Array(x_grid_flat);
        xi = new Float64Array(xi);
        t = new Float64Array(t);
        Q2 = new Float64Array(Q2);
        gpd_5d_flat = new Float64Array(gpd_5d_flat);
        
        loading_overlay.style.display = 'none';
        main_content.style.display = 'block';
        dropdown1.value = chosen_vars[0];
        dropdown2.value = chosen_vars[1];
        colormap_select.value = current_colormap;
        
        // x_grid is 2D: (nx, nxi) - each column is x values for a given xi
        // gpd_5d is: (nx, nxi, nt, nQ2, nreplicas)
        const nxi = xi.length;
        const nt = t.length;
        const nQ2 = Q2.length;
        const nx = x_grid_flat.length / nxi;
        const nreplicas = gpd_5d_flat.length / (nx * nxi * nt * nQ2);
        
        console.log(`Data dimensions: nx=${nx}, nxi=${nxi}, nt=${nt}, nQ2=${nQ2}, nreplicas=${nreplicas}`);
        
        // Reshape x_grid to 2D array
        const x_grid = new ndarray(new Float64Array(x_grid_flat), [nx, nxi]);
        
        // Reshape gpd_5d and store for replica access
        const gpd_5d = new ndarray(gpd_5d_flat, [nx, nxi, nt, nQ2, nreplicas]);
        
        // Calculate the mean of replicas to create a 4D array for the default view
        const gpd_4d_mean_flat = new Float64Array(nx * nxi * nt * nQ2);
        for (let i = 0; i < nx; i++) {
            for (let j = 0; j < nxi; j++) {
                for (let k = 0; k < nt; k++) {
                    for (let l = 0; l < nQ2; l++) {
                        let sum = 0;
                        for (let r = 0; r < nreplicas; r++) {
                            sum += gpd_5d.get(i, j, k, l, r);
                        }
                        const mean = sum / nreplicas;
                        const idx_4d = l + k*nQ2 + j*nQ2*nt + i*nQ2*nt*nxi;
                        gpd_4d_mean_flat[idx_4d] = mean;
                    }
                }
            }
        }
        
        const gpd_4d = new ndarray(gpd_4d_mean_flat, [nx, nxi, nt, nQ2]);
        
        // NOTE: x values actually depend on ξ (x_grid is 2D).
        const xi_initial_idx = 0;
        const x = new Float64Array(nx);
        for (let i = 0; i < nx; i++) {
            x[i] = x_grid.get(i, xi_initial_idx);
        }
        
        var x_xi_t_Q2_array = [x, xi, t, Q2];

        // Get the global min/max of the x_grid for correct normalization
        const [min_x_global, max_x_global] = getExtrema(x_grid.data);

        function updateXArray(xi_index) {
            if (xi_index >= 0 && xi_index < nxi) {
                const new_x = new Float64Array(nx);
                for (let i = 0; i < nx; i++) {
                    new_x[i] = x_grid.get(i, xi_index);
                }
                x_xi_t_Q2_array[0] = new_x;
            }
        }

        [min_gpd, max_gpd] = getExtrema(gpd_5d_flat);
        let current_range = [min_gpd, max_gpd];
        let camera_3d_state = {};
    
        console.log("min_gpd:", min_gpd, "max_gpd:", max_gpd);
    
        // update the colorbar labels:
        document.querySelectorAll('.colorbar-labels')[0].textContent = `${max_gpd.toFixed(3)}`;
        document.querySelectorAll('.colorbar-labels')[1].textContent = `${min_gpd.toFixed(3)}`;
    
        let camera = new THREE.PerspectiveCamera(75, three_container.clientWidth / three_container.clientHeight, 0.1, 1000);
        camera.position.set(0.737, -0.840, 0.108);
        camera.quaternion.set(0.676, 0.057, 0.067, 0.732);
        camera.up.set(0.027, -0.196, 0.980);
    
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
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.95
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
            // Remove and dispose previous z-axis line and label
            if (scene.__zAxisLine) {
                if (scene.__zAxisLine.geometry) scene.__zAxisLine.geometry.dispose();
                if (scene.__zAxisLine.material) scene.__zAxisLine.material.dispose();
                scene.remove(scene.__zAxisLine);
                scene.__zAxisLine = null;
            }
            if (scene.__zAxisLabel) {
                if (scene.__zAxisLabel.material) {
                    if (scene.__zAxisLabel.material.map) scene.__zAxisLabel.material.map.dispose();
                    scene.__zAxisLabel.material.dispose();
                }
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
                // Axis ends at zero, zEnd = 0, zStart = -0.5 (most negative)
                return (min_val === 0) ? z_end : z_start + (z_end - z_start) * ((val - min_val) / (-min_val || 1));
            } else {
                // Axis crosses zero
                return z_start + (z_end - z_start) * ((val - min_val) / ((max_val - min_val) || 1));
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
            let maxv = -Infinity;
            let minv = Infinity;
            arr.forEach(val => {
                maxv = Math.max(maxv, val);
                minv = Math.min(minv, val);
            });
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
                labels[0].style.color = base_color;
                labels[1].style.color = base_color;
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
                    tick.style.backgroundColor = base_color;
                    tick.style.transform = 'translateY(50%)';
                    
                    // Create tick label
                    const tickLabel = document.createElement('div');
                    tickLabel.className = 'colorbar-tick-label';
                    tickLabel.style.position = 'absolute';
                    tickLabel.style.right = '105%';
                    tickLabel.style.bottom = `${position}%`;
                    tickLabel.style.color = base_color;
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
        let heatmap_zoom_transform = null; // Store zoom state
        
        function drawHeatmap() {
            if (heatmap_method === 'all_values') {
                drawHeatmapAllValues();
            } else {
                drawHeatmapInterpolation();
            }
        }

        function drawHeatmapAllValues() {
            // Clear previous heatmap elements (SVG and tooltip) without removing colorbar_container
            heatmap_container.querySelectorAll('svg, .heatmap-tooltip').forEach(el => el.remove());
            heatmap_container.style.background = current_background;
            const axis1 = chosen_vars[0];
            const axis2 = chosen_vars[1];
            const arr1 = x_xi_t_Q2_array[axis1];
            const arr2 = x_xi_t_Q2_array[axis2];
            
            // Use actual array values
            const slice = [];
            for (let j = 0; j < arr2.length; j++) {
                for (let i = 0; i < arr1.length; i++) {
                    let query_index = [0, 0, 0, 0];
                    query_index[axis1] = i;
                    query_index[axis2] = j;
                    query_index[remaining_vars[0]] = control_index[0];
                    query_index[remaining_vars[1]] = control_index[1];
                    
                    const value = gpd_4d.get(query_index[0], query_index[1], query_index[2], query_index[3]);
                    
                    slice.push({
                        i: i,
                        j: j,
                        value: value
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
                .style('display', 'block');
            
            // Create a group for zooming and panning
            const zoom_group = svg.append('g')
                .attr('transform', `translate(${margin.left + horizontal_offset},${margin.top})`);
            
            // Define zoom behavior
            const zoom_behavior = d3.zoom()
                .scaleExtent([0.5, 10]) // Min zoom = 0.5x, Max zoom = 10x
                .on('zoom', (event) => {
                    zoom_group.attr('transform', `translate(${margin.left + horizontal_offset},${margin.top}) ${event.transform}`);
                    heatmap_zoom_transform = event.transform;
                });
            
            // Apply zoom behavior to svg
            svg.call(zoom_behavior);
            
            // Restore previous zoom state if exists
            if (heatmap_zoom_transform) {
                svg.call(zoom_behavior.transform, heatmap_zoom_transform);
            }
            
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
                .style('z-index', '10');
            
            // Create scales based on actual data values
            const x_scale = d3.scaleLinear()
                .domain([d3.min(arr1), d3.max(arr1)])
                .range([0, square_size]);
            
            const y_scale = d3.scaleLinear()
                .domain([d3.min(arr2), d3.max(arr2)])
                .range([square_size, 0]);
            
            // Mouse events for tooltip
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
            
            zoom_group.selectAll('rect')
                .data(slice)
                .join('rect')
                .attr('x', d => {
                    // Calculate cell boundaries based on actual array values
                    let x_left, x_right;
                    if (d.i === 0) {
                        x_left = x_scale(arr1[0]);
                        x_right = x_scale((arr1[0] + arr1[1]) / 2);
                    } else if (d.i === arr1.length - 1) {
                        x_left = x_scale((arr1[arr1.length - 2] + arr1[arr1.length - 1]) / 2);
                        x_right = x_scale(arr1[arr1.length - 1]);
                    } else {
                        x_left = x_scale((arr1[d.i - 1] + arr1[d.i]) / 2);
                        x_right = x_scale((arr1[d.i] + arr1[d.i + 1]) / 2);
                    }
                    return Math.min(x_left, x_right);
                })
                .attr('y', d => {
                    // Calculate cell boundaries based on actual array values
                    let y_top, y_bottom;
                    if (d.j === 0) {
                        y_top = y_scale(arr2[0]);
                        y_bottom = y_scale((arr2[0] + arr2[1]) / 2);
                    } else if (d.j === arr2.length - 1) {
                        y_top = y_scale((arr2[arr2.length - 2] + arr2[arr2.length - 1]) / 2);
                        y_bottom = y_scale(arr2[arr2.length - 1]);
                    } else {
                        y_top = y_scale((arr2[d.j] + arr2[d.j + 1]) / 2);
                        y_bottom = y_scale((arr2[d.j - 1] + arr2[d.j]) / 2);
                    }
                    return Math.min(y_top, y_bottom);
                })
                .attr('width', d => {
                    // Width based on midpoints between adjacent cells
                    let x_left, x_right;
                    if (d.i === 0) {
                        x_left = x_scale(arr1[0]);
                        x_right = x_scale((arr1[0] + arr1[1]) / 2);
                    } else if (d.i === arr1.length - 1) {
                        x_left = x_scale((arr1[arr1.length - 2] + arr1[arr1.length - 1]) / 2);
                        x_right = x_scale(arr1[arr1.length - 1]);
                    } else {
                        x_left = x_scale((arr1[d.i - 1] + arr1[d.i]) / 2);
                        x_right = x_scale((arr1[d.i] + arr1[d.i + 1]) / 2);
                    }
                    return Math.abs(x_right - x_left);
                })
                .attr('height', d => {
                    // Height based on midpoints between adjacent cells
                    let y_top, y_bottom;
                    if (d.j === 0) {
                        y_top = y_scale(arr2[0]);
                        y_bottom = y_scale((arr2[0] + arr2[1]) / 2);
                    } else if (d.j === arr2.length - 1) {
                        y_top = y_scale((arr2[arr2.length - 2] + arr2[arr2.length - 1]) / 2);
                        y_bottom = y_scale(arr2[arr2.length - 1]);
                    } else {
                        y_top = y_scale((arr2[d.j] + arr2[d.j + 1]) / 2);
                        y_bottom = y_scale((arr2[d.j - 1] + arr2[d.j]) / 2);
                    }
                    return Math.abs(y_bottom - y_top);
                })
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
            zoom_group.append("g")
                .attr("transform", `translate(0,${square_size})`)
                .call(x_axis)
                .selectAll("text")
                .style("fill", base_color);
            zoom_group.selectAll(".tick line").attr("stroke", base_color);
            zoom_group.selectAll(".domain").attr("stroke", base_color);

            // Add Y axis
            const y_axis = d3.axisLeft(y_scale).ticks(5);
            zoom_group.append("g")
                .call(y_axis)
                .selectAll("text")
                .style("fill", base_color);
            zoom_group.selectAll(".tick line").attr("stroke", base_color);
            zoom_group.selectAll(".domain").attr("stroke", base_color);

            // Axis labels
            zoom_group.append('text')
                .attr('x', square_size + 10)
                .attr('y', square_size + 15)
                .attr('text-anchor', 'start')
                .attr('font-size', '24px')
                .attr('font-weight', 'bold')
                .attr('fill', base_color)
                .text(axis_labels[axis1]);
            zoom_group.append('text')
                .attr('x', -10)
                .attr('y', -5)
                .attr('text-anchor', 'end')
                .attr('font-size', '24px')
                .attr('font-weight', 'bold')
                .attr('fill', base_color)
                .text(axis_labels[axis2]);

            if (!heatmap_container.contains(colorbar_container)) {
                heatmap_container.appendChild(colorbar_container);
            }
        }

        function drawHeatmapInterpolation() {
            // Clear previous heatmap elements (SVG and tooltip) without removing colorbar_container
            heatmap_container.querySelectorAll('svg, .heatmap-tooltip').forEach(el => el.remove());
            heatmap_container.style.background = current_background;
            const axis1 = chosen_vars[0];
            const axis2 = chosen_vars[1];
            const arr1 = x_xi_t_Q2_array[axis1];
            const arr2 = x_xi_t_Q2_array[axis2];

            const dataGrid = [];
            for (let j = 0; j < arr2.length; j++) {
                const row = [];
                for (let i = 0; i < arr1.length; i++) {
                    let query_index = [0, 0, 0, 0];
                    query_index[axis1] = i;
                    query_index[axis2] = j;
                    query_index[remaining_vars[0]] = control_index[0];
                    query_index[remaining_vars[1]] = control_index[1];
                    const value = gpd_4d.get(query_index[0], query_index[1], query_index[2], query_index[3]);
                    row.push(value);
                }
                dataGrid.push(row);
            }

            const bilinearInterpolate = (x, y) => {
                let i = d3.bisectLeft(arr1, x) - 1;
                let j = d3.bisectLeft(arr2, y) - 1;
                i = Math.max(0, Math.min(i, arr1.length - 2));
                j = Math.max(0, Math.min(j, arr2.length - 2));

                const x1 = arr1[i], x2 = arr1[i + 1];
                const y1 = arr2[j], y2 = arr2[j + 1];

                const q11 = dataGrid[j][i];
                const q12 = dataGrid[j + 1][i];
                const q21 = dataGrid[j][i + 1];
                const q22 = dataGrid[j + 1][i + 1];

                const r1 = ((x2 - x) / (x2 - x1)) * q11 + ((x - x1) / (x2 - x1)) * q21;
                const r2 = ((x2 - x) / (x2 - x1)) * q12 + ((x - x1) / (x2 - x1)) * q22;

                return ((y2 - y) / (y2 - y1)) * r1 + ((y - y1) / (y2 - y1)) * r2;
            };

            const margin = {top: 30, right: 50, bottom: 30, left: 30};
            const container_width = heatmap_container.clientWidth - margin.left - margin.right;
            const container_height = heatmap_container.clientHeight - margin.top - margin.bottom;
            const square_size = Math.min(container_width, container_height);
            const total_svg_width = heatmap_container.clientWidth;
            const square_with_margins = square_size + margin.left + margin.right;
            const horizontal_offset = (total_svg_width - square_with_margins) / 2;

            const svg = d3.select(heatmap_container)
                .append('svg')
                .attr('width', total_svg_width)
                .attr('height', square_size + margin.top + margin.bottom)
                .style('display', 'block');

            const zoom_group = svg.append('g')
                .attr('transform', `translate(${margin.left + horizontal_offset},${margin.top})`);

            // Attach zoom behavior
            const zoom_behavior = d3.zoom()
                .scaleExtent([0.5, 10])
                .on('zoom', (event) => {
                    zoom_group.attr('transform', `translate(${margin.left + horizontal_offset},${margin.top}) ${event.transform}`);
                    heatmap_zoom_transform = event.transform;
                });
            svg.call(zoom_behavior);
            if (heatmap_zoom_transform) {
                svg.call(zoom_behavior.transform, heatmap_zoom_transform);
            }

            const x_scale = d3.scaleLinear().domain(d3.extent(arr1)).range([0, square_size]);
            const y_scale = d3.scaleLinear().domain(d3.extent(arr2)).range([square_size, 0]);

            const canvas = document.createElement('canvas');
            canvas.width = 25;
            canvas.height = 25;
            const context = canvas.getContext('2d');
            const imageData = context.createImageData(canvas.width, canvas.height);

            const x_map = d3.scaleLinear().domain([0, 25 - 1]).range(x_scale.domain());
            // Map py=0 (top) to max(arr2) and py=24 (bottom) to min(arr2) to match cartesian y-axis
            const y_map = d3.scaleLinear().domain([0, 25 - 1]).range([y_scale.domain()[1], y_scale.domain()[0]]);

            for (let py = 0; py < 25; py++) {
                for (let px = 0; px < 25; px++) {
                    const x = x_map(px);
                    const y = y_map(py);
                    const value = bilinearInterpolate(x, y);
                    const normalized = (value - current_range[0]) / (current_range[1] - current_range[0] || 1);
                    const rgb = evaluate_cmap(normalized, current_colormap, false);
                    const index = (py * 25 + px) * 4;
                    imageData.data[index] = rgb[0];
                    imageData.data[index + 1] = rgb[1];
                    imageData.data[index + 2] = rgb[2];
                    imageData.data[index + 3] = 255;
                }
            }
            context.putImageData(imageData, 0, 0);

            zoom_group.append('image')
                .attr('x', 0)
                .attr('y', 0)
                .attr('width', square_size)
                .attr('height', square_size)
                .attr('preserveAspectRatio', 'none')
                .attr('image-rendering', 'pixelated') // Use 'auto' for smoother look, 'pixelated' for sharp
                .attr('href', canvas.toDataURL());

            const x_axis = d3.axisBottom(x_scale);
            const y_axis = d3.axisLeft(y_scale);

            zoom_group.append('g').attr('transform', `translate(0,${square_size})`).call(x_axis).selectAll('text').style('fill', base_color);
            zoom_group.append('g').call(y_axis).selectAll('text').style('fill', base_color);
            zoom_group.selectAll('.domain, .tick line').style('stroke', base_color);

            // Axis labels - matching drawHeatmapAllValues style
            zoom_group.append('text')
                .attr('x', square_size + 10)
                .attr('y', square_size + 15)
                .attr('text-anchor', 'start')
                .attr('font-size', '24px')
                .attr('font-weight', 'bold')
                .attr('fill', base_color)
                .text(axis_labels[axis1]);
            zoom_group.append('text')
                .attr('x', -10)
                .attr('y', -5)
                .attr('text-anchor', 'end')
                .attr('font-size', '24px')
                .attr('font-weight', 'bold')
                .attr('fill', base_color)
                .text(axis_labels[axis2]);

            const tooltip = d3.select(heatmap_container)
                .append('div')
                .style('opacity', 0)
                .attr('class', 'heatmap-tooltip')
                .style('position', 'absolute')
                .style('background-color', 'rgba(0, 0, 0, 0.8)')
                .style('color', 'white')
                .style('border-radius', '5px')
                .style('padding', '8px')
                .style('font-size', '12px')
                .style('pointer-events', 'none')
                .style('z-index', '10');

            zoom_group.append('rect')
                .attr('width', square_size)
                .attr('height', square_size)
                .style('fill', 'none')
                .style('pointer-events', 'all')
                .on('mouseover', () => tooltip.style('opacity', 1))
                .on('mouseout', () => tooltip.style('opacity', 0))
                .on('mousemove', (event) => {
                    const [mx, my] = d3.pointer(event);
                    const x = x_scale.invert(mx);
                    const y = y_scale.invert(my);
                    const value = bilinearInterpolate(x, y);

                    const container_rect = heatmap_container.getBoundingClientRect();
                    const mouseX = event.clientX - container_rect.left;
                    const mouseY = event.clientY - container_rect.top;
                    const tooltip_offset = 10;

                    tooltip
                        .html(`GPD: ${value.toFixed(4)}<br>${axis_labels[axis1]}: ${x.toFixed(4)}<br>${axis_labels[axis2]}: ${y.toFixed(4)}`);

                    const tooltip_node = tooltip.node();
                    const tooltip_width = tooltip_node ? tooltip_node.offsetWidth : 100;
                    const tooltip_height = tooltip_node ? tooltip_node.offsetHeight : 50;

                    let tooltipX = mouseX + tooltip_offset;
                    let tooltipY = mouseY + tooltip_offset;

                    if (tooltipX + tooltip_width > heatmap_container.clientWidth) {
                        tooltipX = mouseX - tooltip_width - tooltip_offset;
                    }
                    if (tooltipY + tooltip_height > heatmap_container.clientHeight) {
                        tooltipY = mouseY - tooltip_height - tooltip_offset;
                    }

                    tooltipX = Math.max(0, Math.min(tooltipX, heatmap_container.clientWidth - tooltip_width));
                    tooltipY = Math.max(0, Math.min(tooltipY, heatmap_container.clientHeight - tooltip_height));

                    tooltip
                        .style('left', tooltipX + 'px')
                        .style('top', tooltipY + 'px');
                });

            if (!heatmap_container.contains(colorbar_container)) {
                heatmap_container.appendChild(colorbar_container);
            }
        }

        function updateCurrentRange() {
            if (use_local_range) {
                let curMin = Infinity, curMax = -Infinity;
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
                if(heatmap_controls) heatmap_controls.style.display = 'flex';
                drawHeatmap();
                // Disable multi-surface controls in 2D view
                if (multi_surface_btn1) multi_surface_btn1.disabled = true;
                if (multi_surface_btn2) multi_surface_btn2.disabled = true;
            } else {
                three_container.style.display = 'block';
                heatmap_container.style.display = 'none';
                if(heatmap_controls) heatmap_controls.style.display = 'none';
                if (renderer) renderer.setClearColor(current_background);
                // Enable multi-surface controls in 3D view
                if (multi_surface_btn1) multi_surface_btn1.disabled = false;
                if (multi_surface_btn2) multi_surface_btn2.disabled = false;
                // Ensure 3D scene gets updated with any slider movement from 2D view
                slider_changed = true;
                if (scene) {
                    drawAxisTicks(scene, 'z', current_range[0], current_range[1], 4, [min_axis1, max_axis1], [min_axis2, max_axis2]);
                }
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

        // Helper to update toggle view button state when animations start or stop
        function updateToggleViewBtnState() {
            if (!toggle_view_btn) return;
            const isPlaying = Boolean(window.slider1Playing || window.slider2Playing);
            toggle_view_btn.disabled = isPlaying;
            if (isPlaying) {
                toggle_view_btn.classList.add('disabled');
                toggle_view_btn.setAttribute('title', 'View switching is disabled during animation');
            } else {
                toggle_view_btn.classList.remove('disabled');
                toggle_view_btn.removeAttribute('title');
            }
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
                updateToggleViewBtnState();
                return;
            }

            window[playingFlag] = true;
            playBtn.innerHTML = '<i class="fas fa-pause"></i>';
            updateToggleViewBtnState();

            window[intervalVar] = setInterval(() => {
                if (!window[playingFlag]) {
                    clearInterval(window[intervalVar]);
                    window[intervalVar] = null;
                    playBtn.innerHTML = '<i class="fas fa-play"></i>';
                    updateToggleViewBtnState();
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

                // If slider controls xi, update the x array
                if (remaining_vars[idx] === 1) {
                    updateXArray(current);
                }

                updateColorbar(min_gpd, max_gpd, current_colormap);
                
                // Update 2D heatmap if in 2D view mode
                if (is_2d_view) {
                    drawHeatmap();
                }
            }, 200);
        }

        function createWireframeGeometry(width, height, segmentsX, segmentsY) {
            const geometry = new THREE.PlaneGeometry(width, height, segmentsX, segmentsY);
            const wireframeGeometry = new THREE.WireframeGeometry(geometry);
            return wireframeGeometry;
        }

        function createCheckerboardCanvas(color1, color2, size = 2) {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const context = canvas.getContext('2d');
            
            // Draw color1 as background
            context.fillStyle = color1;
            context.fillRect(0, 0, size, size);

            // Draw color2 for alternating squares
            context.fillStyle = color2;
            const step = size / 2;
            context.fillRect(0, 0, step, step);
            context.fillRect(step, step, step, step);

            return canvas;
        }

        function updateZeroPlane(type) {
            if (!scene) return;

            // Remove the existing zero plane
            if (scene.__zeroPlane) {
                scene.remove(scene.__zeroPlane);
                scene.__zeroPlane.geometry.dispose();
                if (scene.__zeroPlane.material.map) {
                    scene.__zeroPlane.material.map.dispose();
                }
                scene.__zeroPlane.material.dispose();
                scene.__zeroPlane = null;
            }

            if (type === 'none') return;

            let zeroPlaneGeometry, zeroPlaneMaterial, zeroPlane;
            let zeroPlaneOpacity = 0.3;

            switch (type) {
                case 'gray':
                    zeroPlaneGeometry = new THREE.PlaneGeometry(1.1, 1.1);
                    zeroPlaneMaterial = new THREE.MeshBasicMaterial({
                        color: 0x888888,
                        transparent: true,
                        opacity: zeroPlaneOpacity,
                        side: THREE.DoubleSide,
                        depthWrite: false,
                    });
                    zeroPlane = new THREE.Mesh(zeroPlaneGeometry, zeroPlaneMaterial);
                    break;
                case 'checkerboard':
                    zeroPlaneGeometry = new THREE.PlaneGeometry(1.1, 1.1);
                    const checkerboardCanvas = createCheckerboardCanvas('#cccccc', '#999999', 2);
                    const checkerboardTexture = new THREE.CanvasTexture(checkerboardCanvas);
                    checkerboardTexture.wrapS = THREE.RepeatWrapping;
                    checkerboardTexture.wrapT = THREE.RepeatWrapping;
                    checkerboardTexture.repeat.set(5, 5);
                    checkerboardTexture.magFilter = THREE.NearestFilter;

                    zeroPlaneMaterial = new THREE.MeshBasicMaterial({
                        map: checkerboardTexture,
                        transparent: true,
                        opacity: zeroPlaneOpacity,
                        side: THREE.DoubleSide,
                        depthWrite: false,
                    });
                    zeroPlane = new THREE.Mesh(zeroPlaneGeometry, zeroPlaneMaterial);
                    break;
                case 'wireframe':
                    zeroPlaneGeometry = createWireframeGeometry(1.1, 1.1, 8, 8);
                    zeroPlaneMaterial = new THREE.LineBasicMaterial({
                        color: 0x888888,
                        linewidth: 1,
                        transparent: true,
                        opacity: zeroPlaneOpacity,
                        depthWrite: false,
                    });
                    zeroPlane = new THREE.LineSegments(zeroPlaneGeometry, zeroPlaneMaterial);
                    break;
            }

            if (zeroPlane) {
                zeroPlane.position.set(0.5, 0.5, 0.0001); // Position it slightly off z=0
                zeroPlane.renderOrder = 1; // Render after the main surface so depth testing works properly without occluding geometry behind it
                scene.add(zeroPlane);
                scene.__zeroPlane = zeroPlane;
            }
        }

        function cleanupScene() {
            if (!scene) return;
            scene.traverse(object => {
                if (object.isMesh || object.isLineSegments) {
                    if (object.geometry) {
                        object.geometry.dispose();
                    }
                    if (object.material) {
                        if (Array.isArray(object.material)) {
                            object.material.forEach(material => material.dispose());
                        } else {
                            object.material.dispose();
                        }
                    }
                }
            });
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
    
                cleanupScene(); // Dispose of old scene objects before creating a new one
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

                // Add a zero plane to show where GPD=0 is
                updateZeroPlane(current_zero_plane);
                
                drawAxisTicks(scene, 'z', current_range[0], current_range[1], 4, [min_axis1, max_axis1], [min_axis2, max_axis2]);
                drawAxisTicks(scene, 'x', min_axis1, max_axis1);
                drawAxisTicks(scene, 'y', min_axis2, max_axis2);
    
                axis_scene = new THREE.Scene();
                let orient_axis = create_axis_with_labels(new THREE.Vector3(0, 0, 0), 5.0, 1.0, axis_labels[chosen_vars[0]], axis_labels[chosen_vars[1]], "GPD", '#06b6d4', '#f59e0b', '#8b5cf6', true, 1.0, 0.2, [min_axis1, max_axis1], [min_axis2, max_axis2]);
                orient_axis.forEach(element => { axis_scene.add(element); });
    
                positions = geometry.attributes.position;
                colors = new Float32Array(positions.count * 3);
                
                // Check if we're visualizing x vs ξ (indices 0 and 1)
                const is_x_xi_plot = (chosen_vars[0] === 0 && chosen_vars[1] === 1) || 
                                     (chosen_vars[0] === 1 && chosen_vars[1] === 0);
                
                for (let i = 0; i < positions.count; i++) {
                    let axis2_index = Math.floor(i / arrays1[0].length);
                    let axis1_index = i % arrays1[0].length;
                    
                    let axis1_value, axis2_value;
                    
                    if (is_x_xi_plot) {
                        // Use the 2D x_grid for correct x values at each ξ
                        console.log("This is x vs ξ plot, using x_grid for x values.");
                        if (chosen_vars[0] === 0) { // x is axis1, ξ is axis2
                            const x_val = x_grid.get(axis1_index, axis2_index);
                            axis1_value = (x_val - min_x_global) / (max_x_global - min_x_global);
                            axis2_value = (arrays1[1][axis2_index] - min_axis2) / (max_axis2 - min_axis2);
                        } else { // ξ is axis1, x is axis2
                            const x_val = x_grid.get(axis2_index, axis1_index);
                            axis1_value = (arrays1[0][axis1_index] - min_axis1) / (max_axis1 - min_axis1);
                            axis2_value = (x_val - min_x_global) / (max_x_global - min_x_global);
                        }
                    } else {
                        // Standard case: independent arrays
                        axis1_value = (arrays1[0][axis1_index] - min_axis1) / (max_axis1 - min_axis1);
                        axis2_value = (arrays1[1][axis2_index] - min_axis2) / (max_axis2 - min_axis2);
                    }
                    
                    positions.setX(i, axis1_value);
                    positions.setY(i, axis2_value);
                }
                controls.target.set(0.5, 0.5, 0);
                controls.update();
            }
    
            // Only update 3D mesh and render 3D scene if 3D view is active
            if (!is_2d_view) {
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

                    if (multi_surface_active !== null) {
                        updateMultipleSurfaces(zStart, zEnd);
                    }
                }

                render3DScene();
            }
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
            camera.position.set(0.737, -0.840, 0.108);
            camera.quaternion.set(0.676, 0.057, 0.067, 0.732);
            camera.up.set(0.027, -0.196, 0.980);
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
            
            // Reset heatmap zoom
            heatmap_zoom_transform = null;
            if (is_2d_view) {
                drawHeatmap(); // Redraw heatmap to apply zoom reset
            }
            
            applyBackground(current_background);
            updateSceneInfo('View reset to default');
        }
    
        /* Add event listeners below */
        if (slider1) {
            // Stop animation if user interacts with slider manually
            slider1.noUiSlider.on('start', function() {
                if (window.slider1Playing) {
                    window.slider1Playing = false;
                    play_slider_btn1.innerHTML = '<i class="fas fa-play"></i>';
                    clearInterval(window.slider1Interval);
                    window.slider1Interval = null;
                    updateToggleViewBtnState();
                }
            });
            slider1.noUiSlider.on('update', function (values, handle) {
                let value = parseInt(values[handle]);
                if (control_index[0] !== value) {
                    control_index[0] = value;
                    slider_changed = true;
                    
                    // If slider 1 controls xi, update the x array
                    if (remaining_vars[0] === 1) { // 1 is the index for xi
                        updateXArray(value);
                    }

                    if (!is_2d_view && multi_surface_active !== null) {
                        updateMultipleSurfaces();
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
                }
            });
        }
        if (slider2) {
            // Stop animation if user interacts with slider manually
            slider2.noUiSlider.on('start', function() {
                if (window.slider2Playing) {
                    window.slider2Playing = false;
                    play_slider_btn2.innerHTML = '<i class="fas fa-play"></i>';
                    clearInterval(window.slider2Interval);
                    window.slider2Interval = null;
                    updateToggleViewBtnState();
                }
            });
            slider2.noUiSlider.on('update', function (values, handle) {
                let value = parseInt(values[handle]);
                if (control_index[1] !== value) {
                    control_index[1] = value;
                    slider_changed = true;

                    // If slider 2 controls xi, update the x array
                    if (remaining_vars[1] === 1) { // 1 is the index for xi
                        updateXArray(value);
                    }

                    if (!is_2d_view && multi_surface_active !== null) {
                        updateMultipleSurfaces();
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
            updateToggleViewBtnState();
        }
    
        function updateMultipleSurfaces(zStart, zEnd) {
            if (multi_surface_active === null || is_2d_view || !scene || !geometry) return;

            if (zStart === undefined || zEnd === undefined) {
                const zRange = drawZAxis(scene, current_range[0], current_range[1], [min_axis1, max_axis1], [min_axis2, max_axis2]);
                zStart = zRange[0];
                zEnd = zRange[1];
            }

            const count = geometry.attributes.position.count;

            // Check if existing replica meshes need creation or re-creation
            const needsCreate = !scene.__multiSurfaces || 
                                scene.__multiSurfaces.length !== nreplicas || 
                                !scene.__multiSurfaces[0].geometry || 
                                scene.__multiSurfaces[0].geometry.attributes.position.count !== count;

            if (needsCreate) {
                if (scene.__multiSurfaces) {
                    scene.__multiSurfaces.forEach(m => {
                        if (m.geometry) m.geometry.dispose();
                        if (m.material) m.material.dispose();
                        scene.remove(m);
                    });
                }
                scene.__multiSurfaces = [];

                for (let r = 0; r < nreplicas; r++) {
                    let surfaceGeometry = geometry.clone();
                    let surfaceMaterial = material.clone();
                    surfaceMaterial.transparent = true;
                    surfaceMaterial.opacity = 0.5;
                    let surfaceColors = new Float32Array(count * 3);
                    surfaceGeometry.setAttribute('color', new THREE.BufferAttribute(surfaceColors, 3));
                    let mesh = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
                    scene.add(mesh);
                    scene.__multiSurfaces.push(mesh);
                }
            }

            // Update vertex positions (X, Y, Z) and colors for each replica in-place
            let query_index = [0, 0, 0, 0];
            query_index[remaining_vars[0]] = control_index[0];
            query_index[remaining_vars[1]] = control_index[1];

            const mainPositions = geometry.attributes.position;

            for (let r = 0; r < nreplicas; r++) {
                const mesh = scene.__multiSurfaces[r];
                const surfacePositions = mesh.geometry.attributes.position;
                const surfaceColors = mesh.geometry.attributes.color.array;

                for (let j = 0; j < arrays1[1].length; j++) {
                    for (let i = 0; i < arrays1[0].length; i++) {
                        const idx = j * arrays1[0].length + i;
                        query_index[chosen_vars[0]] = i;
                        query_index[chosen_vars[1]] = j;

                        let gpd_raw_value = gpd_5d.get(query_index[0], query_index[1], query_index[2], query_index[3], r);
                        const z_value = valueToZ(gpd_raw_value, current_range[0], current_range[1], zStart, zEnd);
                        
                        surfacePositions.setX(idx, mainPositions.getX(idx));
                        surfacePositions.setY(idx, mainPositions.getY(idx));
                        surfacePositions.setZ(idx, z_value);

                        let normalized_gpd = (gpd_raw_value - current_range[0]) / (current_range[1] - current_range[0]);
                        let color = evaluate_cmap(normalized_gpd, current_colormap, false);
                        surfaceColors[idx * 3] = color[0] / 255.;
                        surfaceColors[idx * 3 + 1] = color[1] / 255.;
                        surfaceColors[idx * 3 + 2] = color[2] / 255.;
                    }
                }

                surfacePositions.needsUpdate = true;
                mesh.geometry.attributes.color.needsUpdate = true;
                mesh.geometry.computeVertexNormals();
            }
        }

        function toggleMultipleSurfaces(idx) {
            // If already active on the same button, toggle off
            if (multi_surface_active === idx) {
                clearMultiSurface();
                return;
            }

            multi_surface_active = idx;
            if (multi_surface_btn1) {
                multi_surface_btn1.classList.toggle('btn-secondary', idx === 0);
                multi_surface_btn1.classList.toggle('btn-outline-secondary', idx !== 0);
            }
            if (multi_surface_btn2) {
                multi_surface_btn2.classList.toggle('btn-secondary', idx === 1);
                multi_surface_btn2.classList.toggle('btn-outline-secondary', idx !== 1);
            }

            slider_changed = true;
            updateMultipleSurfaces();
            render3DScene();
        }

        function showMultipleSurfaces(idx) {
            toggleMultipleSurfaces(idx);
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
                scene.__multiSurfaces.forEach(m => {
                    if (m.geometry) m.geometry.dispose();
                    if (m.material) m.material.dispose();
                    scene.remove(m);
                });
                scene.__multiSurfaces = [];
                render3DScene();
            }
        }

        multi_surface_btn1.addEventListener('click', function() {
            toggleMultipleSurfaces(0);
        });
        multi_surface_btn2.addEventListener('click', function() {
            toggleMultipleSurfaces(1);
        });
    
        if (dropdown1) {
            dropdown1.addEventListener('change', function() {
                stopAllAnimations();
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
                stopAllAnimations();
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
            toggle_view_btn.addEventListener('click', () => {
                if (window.slider1Playing || window.slider2Playing) {
                    return;
                }
                is_2d_view = !is_2d_view;
                toggle_view_btn.innerHTML = is_2d_view
                    ? '<i class="fas fa-globe me-1"></i>3D View'
                    : '<i class="fas fa-map me-1"></i>2D Heatmap';
                
                if (is_2d_view) {
                    // Save 3D camera state
                    camera_3d_state = {
                        position: camera.position.clone(),
                        quaternion: camera.quaternion.clone(),
                        up: camera.up.clone()
                    };
                } else {
                    // Restore 3D camera state
                    if (camera_3d_state.position) {
                        camera.position.copy(camera_3d_state.position);
                        camera.quaternion.copy(camera_3d_state.quaternion);
                        camera.up.copy(camera_3d_state.up);
                        controls.update();
                    }
                }
                updateViewMode();
            });
        }

        if (reset_view_btn) {
            reset_view_btn.addEventListener('click', resetView);
        }
    
        if (colormap_select) {
            colormap_select.addEventListener('change', function() {
                current_colormap = colormap_select.value;
                updateColorbar(current_range[0], current_range[1], current_colormap);
                if (is_2d_view) {
                    drawHeatmap();
                } else {
                    slider_changed = true;
                    if (multi_surface_active !== null) {
                        updateMultipleSurfaces();
                    }
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
                stopAllAnimations();
                use_local_range = !use_local_range;
                range_toggle_btn.innerHTML = use_local_range
                    ? '<i class="fas fa-chart-line me-1"></i> Local Range'
                    : '<i class="fas fa-chart-line me-1"></i> Global Range';

                // Disable/enable play buttons based on range
                if (play_slider_btn1) play_slider_btn1.disabled = use_local_range;
                if (play_slider_btn2) play_slider_btn2.disabled = use_local_range;

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
                if (is_2d_view) {
                    drawHeatmap();
                }
            });
        }

        if (heatmap_method_select) {
            heatmap_method_select.addEventListener('change', (e) => {
                heatmap_method = e.target.value;
                drawHeatmap();
            });
        }

        if (zero_plane_select) {
            zero_plane_select.addEventListener('change', (e) => {
                current_zero_plane = e.target.value;
                updateZeroPlane(current_zero_plane);
            });
        }

        // Window resize handling
        window.addEventListener('resize', function() {
            if (!is_2d_view && three_container.clientWidth > 0 && three_container.clientHeight > 0) {
                camera.aspect = three_container.clientWidth / three_container.clientHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(three_container.clientWidth, three_container.clientHeight);
            }
            if (is_2d_view) {
                drawHeatmap();
            }
        });
    
        // Keyboard shortcuts
        window.addEventListener('keydown', function(event) {
            if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
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
