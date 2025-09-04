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

const axis_labels = [
    'x',
    'ξ',
    't',
    'Q\u00b2' // unicode superscript 2
];
let chosen_vars = [1, 3]        // xi, Q2
let remaining_vars = [0, 2];    // x, t
let control_index = [0, 0];
let dataFiles = [
    { name: "x values (x.npy)", path: "data/x.npy", key: 'x', type: 'npy' },
    { name: "ξ values (xi.npy)", path: "data/xi.npy", key: 'xi', type: 'npy' },
    { name: "t values (t.npy)", path: "data/t.npy", key: 't', type: 'npy' },
    { name: "Q² values (Q2.npy)", path: "data/Q2.npy", key: 'Q2', type: 'npy' },
    { name: "GPD data (gpd_4d.npy)", path: "data/gpd_4d.npy", key: 'gpd_4d', type: 'npy' },
];
let multiSurfaceActive = null; // null, 0, or 1
let slider_changed = true;
let updated_axis = true;

let upload_overlay = document.getElementById('data-upload-overlay');
let loading_overlay = document.getElementById('loading-overlay');
let main_content = document.getElementById('main-content');

const dropdown1 = document.getElementById('dropdown1');
const dropdown2 = document.getElementById('dropdown2');
const slider1 = document.getElementById('slider1');
const slider2 = document.getElementById('slider2');

const multiSurface1Btn = document.getElementById('multi-surface1');
const multiSurface2Btn = document.getElementById('multi-surface2');
const numSurfacesInput = document.getElementById('num-surfaces-input');
let num_surfaces = 10;

const playSlider1Btn = document.getElementById('play-slider1');
const playSlider2Btn = document.getElementById('play-slider2');

let is2DView = false;
const toggleViewBtn = document.getElementById('toggle-view-btn');
const resetViewBtn = document.getElementById('reset-view-btn');
const colormapSelect = document.getElementById('colormap-select');

const colorbarContainer = document.getElementById('colorbar-container');
const threeContainer = document.getElementById("three-container");
const heatmapContainer = document.getElementById('heatmap-container');

// Only allow diverging colormaps for single colormap
let divergingColormaps = ['coolwarm', 'RdBu', 'Spectral', 'PiYG', 'PRGn', 'BrBG', 'PuOr', 'RdGy', 'RdYlBu', 'RdYlGn'];
let currentColormap = 'coolwarm';

// Initialize toggleViewBtn text based on is2DView
if (toggleViewBtn) {
    toggleViewBtn.innerHTML = is2DView
        ? '<i class="fas fa-globe me-1"></i>3D View'
        : '<i class="fas fa-map me-1"></i>2D Heatmap';
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

const bgDropdownMenu = document.getElementById('bg-dropdown-menu');
const bgDropdownToggle = document.getElementById('bg-dropdown-toggle');
let currentBg = '#52576e';

// helper to update custom dropdown toggle label and swatch
function updateBgToggle(color, label) {
    if (!bgDropdownToggle) return;
    const swatch = bgDropdownToggle.querySelector('.bg-swatch');
    const text = bgDropdownToggle.querySelector('span.ms-2');
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
        gpd_vis();
    });

    upload_form.addEventListener('submit', async (e) => {
        e.preventDefault();
        upload_overlay.style.display = 'none';
        document.body.style.overflow = '';
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

    // Ensure background selectors are populated after DOM is ready as well
    if (heatmapContainer) {
        heatmapContainer.style.background = currentBg;
    }
});

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

function gpd_vis() {
    let renderer, scene, min_gpd = Number.MAX_VALUE, max_gpd = Number.MIN_VALUE;
    let baseColor = 'white';

    function applyBackground(color) {
        currentBg = color;
        if (renderer) renderer.setClearColor(color);
        if (heatmapContainer) heatmapContainer.style.background = color;
        // Set text color for heatmap and colorbar labels
        const isWhite = color.toLowerCase() === '#f8fafc' || color.toLowerCase().includes('white');
        baseColor = isWhite ? 'black' : 'white';
        if (heatmapContainer) {
            const svg = heatmapContainer.querySelector('svg');
            if (svg) {
                svg.querySelectorAll('text').forEach(el => el.style.fill = baseColor);
                svg.querySelectorAll('line').forEach(el => el.style.stroke = baseColor);
            }
        }
        if (colorbarContainer) {
            colorbarContainer.querySelectorAll('.colorbar-labels, .colorbar-tick-label').forEach(el => el.style.color = baseColor);
            colorbarContainer.querySelectorAll('.colorbar-tick').forEach(el => el.style.backgroundColor = baseColor);
        }
        if (scene) {
            addZAxisTicks(scene, min_gpd, max_gpd);
        }
    }

    function create_axis_label(text, color) {
        const canvas = document.createElement('canvas');
        const size = 512; // higher resolution for crisp text
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, size, size);
        context.font = 'bold 200px Arial';
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

    function create_axis_with_labels(center, width=10.0, scale=0.5, labelx="x", labely="y", labelz="z", colorx='#06b6d4', colory='#f59e0b', colorz='#8b5cf6', z_centered = false, label_scale = 0.3, label_offset = 0.1) {
        let x_axis = create_axis_line(center, new THREE.Vector3(center.x + scale, center.y, center.z), width, colorx)
        let y_axis = create_axis_line(center, new THREE.Vector3(center.x, center.y + scale, center.z), width, colory)
        
        let z_axis;
        if (z_centered) {
            z_axis = create_axis_line(new THREE.Vector3(center.x, center.y, center.z - scale/2), new THREE.Vector3(center.x, center.y, center.z + scale/2), width, colorz)
        } else {
            z_axis = create_axis_line(center, new THREE.Vector3(center.x, center.y, center.z + scale), width, colorz)
        }
    
        let x_label = create_axis_label(labelx, colorx)
        let y_label = create_axis_label(labely, colory)
        let z_label = create_axis_label(labelz, colorz)
    
        x_label.position.set(center.x + scale + label_offset, center.y, center.z);
        y_label.position.set(center.x, center.y + scale + label_offset, center.z);
    
        if (z_centered) {
            z_label.position.set(center.x, center.y, center.z + scale/2 + label_offset);
        } else {
            z_label.position.set(center.x, center.y, center.z + scale + label_offset);
        }
        
        x_label.scale.set(label_scale, label_scale, label_scale);
        y_label.scale.set(label_scale, label_scale, label_scale);
        z_label.scale.set(label_scale, label_scale, label_scale);
    
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

    // Update colorbar min/max labels and gradient for the single colorbar
    function updateColorbar(min, max, colormap) {
        const labels = colorbarContainer.querySelectorAll('.colorbar-labels');
        if (labels.length >= 2) {
            labels[0].textContent = max.toFixed(3);
            labels[1].textContent = min.toFixed(3);
        }
        
        // Clear existing intermediate ticks and labels
        const existingTicks = colorbarContainer.querySelectorAll('.colorbar-tick, .colorbar-tick-label');
        existingTicks.forEach(tick => tick.remove());
        
        const colorbar = colorbarContainer.querySelector('.colorbar');
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
            const numTicks = 5; // Number of intermediate ticks
            for (let i = 1; i <= numTicks; i++) {
                const fraction = i / (numTicks + 1);
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
        if (is2DView) {
            heatmapContainer.appendChild(colorbarContainer);
        } else {
            threeContainer.appendChild(colorbarContainer);
        }
    }

    // Draw z-axis ticks and labels
    function addZAxisTicks(scene, minGPD, maxGPD, numTicks = 4) {
        const zStart = -0.5;
        const zEnd = 0.5;
        const xPos = 0;
        const yPos = 0;
        const tickLength = 0.02; // length of the tick mark

        // Remove previous ticks if any
        if (scene.__zAxisTicks) {
            scene.__zAxisTicks.forEach(obj => scene.remove(obj));
        }
        const tickObjs = [];

        const createTick = (gpdValue) => {
            const frac = (gpdValue - minGPD) / (maxGPD - minGPD);
            const z = zStart + (zEnd - zStart) * frac;

            // Tick mark (line)
            const tickGeom = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(xPos - tickLength / 2, yPos, z),
                new THREE.Vector3(xPos + tickLength / 2, yPos, z)
            ]);
            const tickMat = new THREE.LineBasicMaterial({ color: baseColor });
            const tickLine = new THREE.Line(tickGeom, tickMat);
            scene.add(tickLine);
            tickObjs.push(tickLine);

            // Label (sprite)
            const canvas = document.createElement('canvas');
            canvas.width = 256; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.font = 'bold 32px Arial';
            ctx.fillStyle = baseColor;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.clearRect(0, 0, 256, 64);
            ctx.fillText(gpdValue.toFixed(3), 5, 32);
            const tex = new THREE.CanvasTexture(canvas);
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            const sprite = new THREE.Sprite(mat);
            sprite.position.set(xPos - tickLength / 2, yPos, z);
            sprite.scale.set(0.18, 0.045, 1);
            scene.add(sprite);
            tickObjs.push(sprite);
        };

        // Always include a tick at 0
        createTick(0);

        // Add ticks on the positive side
        for (let i = 1; i <= numTicks; i++) {
            createTick(i * maxGPD / numTicks);
        }

        // Add ticks on the negative side
        for (let i = 1; i <= numTicks; i++) {
            createTick(i * minGPD / numTicks);
        }

        scene.__zAxisTicks = tickObjs;
    }

    Promise.all(load_data_files())
    .then(([x, xi, t, Q2, gpd_4d_flat]) => {
        // Wire custom dropdown clicks -> update color and label
        if (bgDropdownMenu) {
            bgDropdownMenu.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-color]');
                if (!btn) return;
                const color = btn.getAttribute('data-color');
                const label = btn.getAttribute('data-label') || '';
                currentBg = color;
                applyBackground(currentBg);
                updateBgToggle(currentBg, label);
            });
        }

        window.addEventListener('DOMContentLoaded', () => {
            applyBackground(currentBg);
        });
        
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
        let camera_3d_state = {};
    
        console.log("min_gpd:", min_gpd, "max_gpd:", max_gpd);
    
        // update the colorbar labels:
        document.querySelectorAll('.colorbar-labels')[0].textContent = `${max_gpd.toFixed(3)}`;
        document.querySelectorAll('.colorbar-labels')[1].textContent = `${min_gpd.toFixed(3)}`;
    
        let camera = new THREE.PerspectiveCamera(75, threeContainer.clientWidth / threeContainer.clientHeight, 0.1, 1000);
        camera.position.set(0.147, -0.898, 0.165);
        camera.quaternion.set(0.658, -0.102, -0.070, 0.743);
        camera.up.set(-0.094, -0.145, 0.985);
    
        renderer = new THREE.WebGLRenderer({antialias:true});
        renderer.setClearColor(currentBg);
        renderer.setSize( threeContainer.clientWidth, threeContainer.clientHeight );
        threeContainer.appendChild(renderer.domElement);

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

        // Helper to draw D3 heatmap for current 2D slice
        function drawHeatmap() {
            heatmapContainer.innerHTML = '';
            heatmapContainer.style.background = currentBg;
            const axis1 = chosen_vars[0];
            const axis2 = chosen_vars[1];
            const arr1 = x_xi_t_Q2_array[axis1];
            const arr2 = x_xi_t_Q2_array[axis2];
            const targetGridSize = 20;
            // const targetGridSize = Math.min(arr1.length, arr2.length);
            
            // Helper function for linear interpolation
            function interpolateValue(targetIndex, sourceLength, targetLength) {
                const ratio = (sourceLength - 1) / (targetLength - 1);
                const exactIndex = targetIndex * ratio;
                const lowerIndex = Math.floor(exactIndex);
                const upperIndex = Math.min(lowerIndex + 1, sourceLength - 1);
                const fraction = exactIndex - lowerIndex;
                return { lowerIndex, upperIndex, fraction };
            }
            
            // Prepare 2D data slice for D3 with interpolation
            const slice = [];
            for (let j = 0; j < targetGridSize; j++) {
                for (let i = 0; i < targetGridSize; i++) {
                    let query_index = [0, 0, 0, 0];
                    
                    // Handle interpolation for axis1
                    let axis1_indices;
                    if (arr1.length === targetGridSize) {
                        axis1_indices = { lowerIndex: i, upperIndex: i, fraction: 0 };
                    } else {
                        axis1_indices = interpolateValue(i, arr1.length, targetGridSize);
                    }
                    
                    // Handle interpolation for axis2
                    let axis2_indices;
                    if (arr2.length === targetGridSize) {
                        axis2_indices = { lowerIndex: j, upperIndex: j, fraction: 0 };
                    } else {
                        axis2_indices = interpolateValue(j, arr2.length, targetGridSize);
                    }
                    
                    // Bilinear interpolation for GPD values
                    let interpolatedValue;
                    if (axis1_indices.fraction === 0 && axis2_indices.fraction === 0) {
                        // No interpolation needed
                        query_index[axis1] = axis1_indices.lowerIndex;
                        query_index[axis2] = axis2_indices.lowerIndex;
                        query_index[remaining_vars[0]] = control_index[0];
                        query_index[remaining_vars[1]] = control_index[1];
                        interpolatedValue = gpd_4d.get(query_index[0], query_index[1], query_index[2], query_index[3]);
                    } else {
                        // Bilinear interpolation
                        const values = [];
                        const indices = [
                            [axis1_indices.lowerIndex, axis2_indices.lowerIndex],
                            [axis1_indices.upperIndex, axis2_indices.lowerIndex],
                            [axis1_indices.lowerIndex, axis2_indices.upperIndex],
                            [axis1_indices.upperIndex, axis2_indices.upperIndex]
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
                        interpolatedValue = v1 * (1 - axis2_indices.fraction) + v2 * axis2_indices.fraction;
                    }
                    
                    slice.push({
                        i: i,
                        j: j,
                        value: interpolatedValue
                    });
                }
            }
            
            // Calculate square dimensions
            const margin = {top: 30, right: 50, bottom: 30, left: 30};
            const containerWidth = heatmapContainer.clientWidth - margin.left - margin.right;
            const containerHeight = heatmapContainer.clientHeight - margin.top - margin.bottom;
            const squareSize = Math.min(containerWidth, containerHeight);
            
            // Calculate horizontal centering offset
            const totalSvgWidth = heatmapContainer.clientWidth;
            const squareWithMargins = squareSize + margin.left + margin.right;
            const horizontalOffset = (totalSvgWidth - squareWithMargins) / 2;
            
            const svg = d3.select(heatmapContainer)
                .append('svg')
                .attr('width', totalSvgWidth)
                .attr('height', squareSize + margin.top + margin.bottom)
                .style('display', 'block')
                .append('g')
                .attr('transform', `translate(${margin.left + horizontalOffset},${margin.top})`);
            
            // Create tooltip
            const tooltip = d3.select(heatmapContainer)
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
            
            // Build X and Y scales for square grid
            const x = d3.scaleBand()
                .range([0, squareSize])
                .domain(d3.range(targetGridSize))
                .padding(0);
            
            const y = d3.scaleBand()
                .range([squareSize, 0])
                .domain(d3.range(targetGridSize))
                .padding(0);
            
            // Tooltip event handlers
            const mouseover = function(event, d) {
                tooltip.style('opacity', 1);
            };
            
            const mousemove = function(event, d) {
                const containerRect = heatmapContainer.getBoundingClientRect();
                const mouseX = event.clientX - containerRect.left;
                const mouseY = event.clientY - containerRect.top;
                const tooltipOffset = 10;
                
                // Set initial position close to mouse
                let tooltipX = mouseX + tooltipOffset;
                let tooltipY = mouseY + tooltipOffset;
                
                // Get tooltip dimensions (temporarily show it to measure)
                tooltip.style('opacity', 1)
                    .html(`<strong>GPD Value:</strong> ${d.value.toFixed(6)}`);
                
                const tooltipNode = tooltip.node();
                const tooltipWidth = tooltipNode.offsetWidth;
                const tooltipHeight = tooltipNode.offsetHeight;
                
                // Edge detection - adjust position if tooltip would go off-screen
                if (tooltipX + tooltipWidth > heatmapContainer.clientWidth) {
                    tooltipX = mouseX - tooltipWidth - tooltipOffset; // Show to the left of cursor
                }
                if (tooltipY + tooltipHeight > heatmapContainer.clientHeight) {
                    tooltipY = mouseY - tooltipHeight - tooltipOffset; // Show above cursor
                }
                
                // Ensure tooltip doesn't go beyond container bounds
                tooltipX = Math.max(0, Math.min(tooltipX, heatmapContainer.clientWidth - tooltipWidth));
                tooltipY = Math.max(0, Math.min(tooltipY, heatmapContainer.clientHeight - tooltipHeight));
                
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
                .attr('x', d => x(d.i))
                .attr('y', d => y(d.j))
                .attr('width', x.bandwidth())
                .attr('height', y.bandwidth())
                .style('fill', d => {
                    let norm = (d.value - min_gpd) / (max_gpd - min_gpd);
                    norm = Math.max(0, Math.min(1, norm));
                    let rgb = evaluate_cmap(norm, currentColormap, false);
                    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
                })
                .style('stroke', 'none')  // Explicitly remove any stroke
                .style('stroke-width', 0)  // Ensure no stroke width
                .style('cursor', 'pointer')
                .on('mouseover', mouseover)
                .on('mousemove', mousemove)
                .on('mouseleave', mouseleave);
            
            // Add tick marks and labels for X axis
            const numXTicks = Math.min(5, targetGridSize);
            const xTickIndices = d3.range(0, targetGridSize, Math.max(1, Math.floor(targetGridSize / (numXTicks - 1))));
            if (xTickIndices[xTickIndices.length - 1] !== targetGridSize - 1) {
                xTickIndices.push(targetGridSize - 1);
            }
            
            xTickIndices.forEach(tickIndex => {
                // Calculate the actual interpolated data value for this tick
                let actualValue;
                if (arr1.length === targetGridSize) {
                    actualValue = arr1[tickIndex];
                } else {
                    const interpolationData = interpolateValue(tickIndex, arr1.length, targetGridSize);
                    const lowerValue = arr1[interpolationData.lowerIndex];
                    const upperValue = arr1[interpolationData.upperIndex];
                    actualValue = lowerValue * (1 - interpolationData.fraction) + upperValue * interpolationData.fraction;
                }
                
                // Draw tick mark
                svg.append('line')
                    .attr('x1', x(tickIndex) + x.bandwidth() / 2)
                    .attr('y1', squareSize)
                    .attr('x2', x(tickIndex) + x.bandwidth() / 2)
                    .attr('y2', squareSize + 5)
                    .attr('stroke', 'white')
                    .attr('stroke-width', 1);
                
                // Draw tick label
                svg.append('text')
                    .attr('x', x(tickIndex) + x.bandwidth() / 2)
                    .attr('y', squareSize + 15)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', '10px')
                    .attr('fill', 'white')
                    .text(actualValue.toFixed(3));
            });
            
            // Add tick marks and labels for Y axis
            const numYTicks = Math.min(5, targetGridSize);
            const yTickIndices = d3.range(0, targetGridSize, Math.max(1, Math.floor(targetGridSize / (numYTicks - 1))));
            if (yTickIndices[yTickIndices.length - 1] !== targetGridSize - 1) {
                yTickIndices.push(targetGridSize - 1);
            }
            
            yTickIndices.forEach(tickIndex => {
                // Calculate the actual interpolated data value for this tick
                let actualValue;
                if (arr2.length === targetGridSize) {
                    actualValue = arr2[tickIndex];
                } else {
                    const interpolationData = interpolateValue(tickIndex, arr2.length, targetGridSize);
                    const lowerValue = arr2[interpolationData.lowerIndex];
                    const upperValue = arr2[interpolationData.upperIndex];
                    actualValue = lowerValue * (1 - interpolationData.fraction) + upperValue * interpolationData.fraction;
                }
                
                // Draw tick mark
                svg.append('line')
                    .attr('x1', -5)
                    .attr('y1', y(tickIndex) + y.bandwidth() / 2)
                    .attr('x2', 0)
                    .attr('y2', y(tickIndex) + y.bandwidth() / 2)
                    .attr('stroke', 'white')
                    .attr('stroke-width', 1);
                
                // Draw tick label
                svg.append('text')
                    .attr('x', -10)
                    .attr('y', y(tickIndex) + y.bandwidth() / 2)
                    .attr('text-anchor', 'end')
                    .attr('dominant-baseline', 'middle')
                    .attr('font-size', '10px')
                    .attr('fill', 'white')
                    .text(actualValue.toFixed(3));
            });
            
            // Axis labels
            svg.append('text')
                .attr('x', squareSize + 10)
                .attr('y', squareSize + 15)
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

            if (!heatmapContainer.contains(colorbarContainer)) {
                heatmapContainer.appendChild(colorbarContainer);
            }
        }

        // Toggle between Three.js and D3 heatmap
        function updateViewMode() {
            if (is2DView) {
                threeContainer.style.display = 'none';
                heatmapContainer.style.display = 'block';
                heatmapContainer.style.background = currentBg;
                drawHeatmap();
                // Disable multi-surface controls in 2D view
                if (multiSurface1Btn) multiSurface1Btn.disabled = true;
                if (multiSurface2Btn) multiSurface2Btn.disabled = true;
                if (numSurfacesInput) numSurfacesInput.disabled = true;
            } else {
                threeContainer.style.display = 'block';
                heatmapContainer.style.display = 'none';
                if (renderer) renderer.setClearColor(currentBg);
                // Enable multi-surface controls in 3D view
                if (multiSurface1Btn) multiSurface1Btn.disabled = false;
                if (multiSurface2Btn) multiSurface2Btn.disabled = false;
                if (numSurfacesInput) numSurfacesInput.disabled = false;
                
                // Force resize the renderer after switching to 3D view
                setTimeout(() => {
                    if (camera && renderer) {
                        camera.aspect = threeContainer.clientWidth / threeContainer.clientHeight;
                        camera.updateProjectionMatrix();
                        renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
                    }
                }, 0);
            }
            applyBackground(currentBg);
            moveColorbarToCurrentView();
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
                
                // Update 2D heatmap if in 2D view mode
                if (is2DView) {
                    drawHeatmap();
                }
            }, 200);
        }

        // Standalone function to render the 3D scene
        function render3DScene() {
            // Main scene rendering
            renderer.setViewport(0, 0, threeContainer.clientWidth, threeContainer.clientHeight);
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
    
                [min_axis1, max_axis1] = get_extreme(arrays1[0]);
                [min_axis2, max_axis2] = get_extreme(arrays1[1]);
    
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
                let global_axis = create_axis_with_labels(new THREE.Vector3(0, 0, 0), 1.0, 1.0, axis_labels[chosen_vars[0]], axis_labels[chosen_vars[1]], "GPD", '#06b6d4', '#f59e0b', '#8b5cf6', true, 0.2, 0.05);
                global_axis.forEach(element => { scene.add(element); });
                
                // Add a reference plane at Z=0 to show where GPD=0 is
                let referencePlaneGeometry = new THREE.PlaneGeometry(1, 1);
                let referencePlaneMaterial = new THREE.MeshBasicMaterial({
                    color: 0xaaaaaa,
                    transparent: true,
                    opacity: 0.5,
                    side: THREE.DoubleSide,
                    polygonOffset: true,
                    polygonOffsetFactor: -1.0,
                    polygonOffsetUnits: -4.0
                });
                let referencePlane = new THREE.Mesh(referencePlaneGeometry, referencePlaneMaterial);
                referencePlane.position.set(0.5, 0.5, 0); // Center at the middle of the XY plane
                scene.add(referencePlane);
                
                scene.add(plane);
                addZAxisTicks(scene, min_gpd, max_gpd);
    
                axis_scene = new THREE.Scene();
                let orient_axis = create_axis_with_labels(new THREE.Vector3(0, 0, 0), 5.0, 1.0, axis_labels[chosen_vars[0]], axis_labels[chosen_vars[1]], "GPD", '#06b6d4', '#f59e0b', '#8b5cf6', false, 1.0, 0.2);
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
                const z_scale = 0.5;
    
                for (let j = 0; j < arrays1[1].length; j++) {
                    for (let i = 0; i < arrays1[0].length; i++) {
                        query_index[chosen_vars[0]] = i;
                        query_index[chosen_vars[1]] = j;
                        query_index[remaining_vars[0]] = control_index[0];
                        query_index[remaining_vars[1]] = control_index[1];
    
                        let gpd_val = gpd_4d.get(query_index[0], query_index[1], query_index[2], query_index[3]);
                        let normalized_gpd = (gpd_val - min_gpd) / (max_gpd - min_gpd);
                        
                        const z = (normalized_gpd - 0.5) * 2 * z_scale;
    
                        let vertex = geometry.attributes.position;
                        vertex.setZ(j * arrays1[0].length + i, z);
    
                        let color = evaluate_cmap(normalized_gpd, currentColormap, false);
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
        const middle0 = Math.floor(arrays2[0].length / 2);
        const middle1 = Math.floor(arrays2[1].length / 2);
        control_index[0] = middle0;
        control_index[1] = middle1;

        noUiSlider.create(slider1, {
            start: [middle0],
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
            start: [middle1],
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
        updateColorbar(min_gpd, max_gpd, currentColormap);
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
            
            applyBackground(currentBg);
            updateSceneInfo('View reset to default');
        }
    
        /* Add event listeners below */
        if (slider1) {
            slider1.noUiSlider.on('change', function(values, handle) {
                control_index[0] = Number(values[0]);
                slider_changed = true;
                if (multiSurfaceActive === 0) {
                    showMultipleSurfaces(0);
                } else {
                    clearMultiSurface();
                }
                // Update view depending on current mode
                if (is2DView) {
                    drawHeatmap();
                }
            });
            // Stop animation if user interacts with slider manually
            slider1.noUiSlider.on('start', function() {
                if (window.slider1Playing) {
                    window.slider1Playing = false;
                    playSlider1Btn.innerHTML = '<i class="fas fa-play"></i>';
                    clearInterval(window.slider1Interval);
                    window.slider1Interval = null;
                }
            });
        }
        if (slider2) {
            slider2.noUiSlider.on('change', function(values, handle) {
                control_index[1] = Number(values[0]);
                slider_changed = true;
                if (multiSurfaceActive === 1) {
                    showMultipleSurfaces(1);
                } else {
                    clearMultiSurface();
                }
                // Update view depending on current mode
                if (is2DView) {
                    drawHeatmap();
                }
            });
            slider2.noUiSlider.on('start', function() {
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
                animateSlider(slider1, arrays2[0], 0, playSlider1Btn, 'slider1Playing', 'slider1Interval');
            });
        }
        if (playSlider2Btn) {
            playSlider2Btn.addEventListener('click', function() {
                animateSlider(slider2, arrays2[1], 1, playSlider2Btn, 'slider2Playing', 'slider2Interval');
            });
        }
    
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
                slider1.noUiSlider.set(0);
                slider2.noUiSlider.set(0);
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
                slider1.noUiSlider.set(0);
                slider2.noUiSlider.set(0);
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
                updateViewMode();
                if (!is2DView) {
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

        if (resetViewBtn) {
            resetViewBtn.addEventListener('click', resetView);
        }

        if (colormapSelect) {
            colormapSelect.addEventListener('change', function() {
                currentColormap = colormapSelect.value;
                updateColorbar(min_gpd, max_gpd, currentColormap);
                if (is2DView) {
                    drawHeatmap();
                }
            });
        }

        // Window resize handling
        window.addEventListener('resize', function() {
            camera.aspect = threeContainer.clientWidth / threeContainer.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
            if (is2DView) {
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
    
        if (numSurfacesInput) {
            numSurfacesInput.addEventListener('change', function() {
                let val = parseInt(numSurfacesInput.value, 10);
                if (isNaN(val) || val < 1) val = 1;
                if (val > 50) val = 50;
                num_surfaces = val;
                numSurfacesInput.value = val;
                if (multiSurfaceActive === 0) showMultipleSurfaces(0);
                if (multiSurfaceActive === 1) showMultipleSurfaces(1);
            });
        }
    
        if (colormapSelect) {
            colormapSelect.addEventListener('change', function() {
                currentColormap = colormapSelect.value;
                updateColorbar(min_gpd, max_gpd, currentColormap);
                if (is2DView) {
                    drawHeatmap();
                }
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
