import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import ndarray from 'ndarray'
import noUiSlider from 'nouislider'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { evaluate_cmap } from "./colormap.js"

function load_array(url) {
    return fetch(url).then(response => {
        if (!response.ok) {
            throw new Error(`Failed to load ${url}, status: ${response.status}`);
        }
        console.log("load success ", url);
        return response.arrayBuffer();
    });
}

function create_label(text, color) {
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

function create_line(start, end, width, color){
    const geometry = new LineSegmentsGeometry().setPositions([start.x, start.y, start.z, end.x, end.y, end.z])
    const material = new LineMaterial({
        color: color,   
        linewidth: width
    });
    return new LineSegments2(geometry, material);
}

function create_axis(center, width=8.0, scale=0.5, labelx="x", labely="y", labelz="z", colorx = '#ff0000', colory='#00ff00', colorz='#0000ff') {
    let x_axis = create_line(center, new THREE.Vector3(center.x + scale, center.y, center.z), width, colorx)
    let y_axis = create_line(center, new THREE.Vector3(center.x, center.y + scale, center.z), width, colory)
    let z_axis = create_line(center, new THREE.Vector3(center.x, center.y, center.z + scale), width, colorz)
    let x_label = create_label(labelx, colorx)
    let y_label = create_label(labely, colory)
    let z_label = create_label(labelz, colorz)
    x_label.position.set(center.x + scale + 0.5, center.y, center.z);
    y_label.position.set(center.x, center.y + scale + 0.5, center.z);
    z_label.position.set(center.x, center.y, center.z + scale + 0.5);
    return [x_axis, y_axis, z_axis, x_label, y_label, z_label];
}

function get_extreme(arr){
    let maxv = -Number.MAX_VALUE;
    let minv = Number.MAX_VALUE;
    arr.forEach(val => {
        maxv = Math.max(maxv, val)
        minv = Math.min(minv, val)
    })
    return [minv, maxv];
}

let loading_overlay = document.getElementById('loading-overlay');
let main_content = document.getElementById('main-content');

const dropdown1 = document.getElementById('dropdown1');
const dropdown2 = document.getElementById('dropdown2');
dropdown1.value = "0";
dropdown2.value = "2"

const axis_labels = [
    'x',
    'x\u1d62', // unicode subscript i
    't',
    'Q\u00b2' // unicode superscript 2
];
let options = [0, 2]
let control_index = [0, 0];
let slider_changed = true;
let updated_axis = true;

const slider_1 = document.getElementById('slider_1');
const slider_2 = document.getElementById('slider_2');

Promise.all([
    load_array("./data/gpd_4d.bin"),
    load_array("./data/x.bin"),
    load_array("./data/xi.bin"),
    load_array("./data/t.bin"),
    load_array("./data/Q2.bin")
])
.then(([gpd_4d_flat, x, xi, t, Q2]) => {
    loading_overlay.style.display = 'none';
    main_content.style.display = 'block';

    gpd_4d_flat = new Float64Array(gpd_4d_flat)
    x = new Float64Array(x)
    xi = new Float64Array(xi)
    t = new Float64Array(t)
    Q2 = new Float64Array(Q2)
    
    var x_xi_t_Q2_array = [x, xi, t, Q2]
    let dims = [x.length, xi.length, t.length, Q2.length]
    let gpd_4d = new ndarray(gpd_4d_flat, dims)
    let [min_gpd, max_gpd] = get_extreme(gpd_4d_flat)

    // After you set min_gpd and max_gpd in your .then() block, update the colorbar labels:
    document.querySelectorAll('.colorbar-labels')[0].textContent = `${max_gpd.toFixed(3)}`;
    document.querySelectorAll('.colorbar-labels')[1].textContent = `${min_gpd.toFixed(3)}`;

    let container = document.getElementById("three-container")
    let camera = new THREE.PerspectiveCamera(75, container.clientWidth /  container.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 0.7)

    let renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setClearColor(.1, .1, .1) 
    renderer.setSize( container.clientWidth, container.clientHeight );
    container.appendChild(renderer.domElement)

    let controls = new TrackballControls(camera, renderer.domElement);
    controls.rotateSpeed = 10.0;
    controls.zoomSpeed = 1.2;

    let min_xi, max_xi, min_Q2, max_Q2;
    let arrays1 = [[], []];
    let arrays2 = [[], []];
    let scene;
    let positions;
    let colors;
    let axis_scene;
    let indices;
    let geometry;

    let material = new THREE.MeshStandardMaterial({
        vertexColors: true,    
        side: THREE.DoubleSide,
        metalness: 0.1,
        roughness: 0.5
    });
    let ambient_light = new THREE.AmbientLight(0xffffff, 0.1);
    let dir_light = new THREE.DirectionalLight(0xffffff, 2);
    dir_light.position.set(1, 1, 1);
    dir_light.castShadow = true;

    let axis_camera = new THREE.OrthographicCamera(-2, 2, 2, -2, -1000, 1000);


    noUiSlider.create(slider_1, {
        start: [0],  
        tooltips: true,  
        step: 1,
        range: {
            min: 0,
            max: arrays1[0].length - 1
          },
          format: {
            to: function (value) {
                return arrays1[0][Math.round(value)];
            },
            from: function (value) {
                return arrays1[0].indexOf(value);
            }
          }
    });

    noUiSlider.create(slider_2, {
        start: [0], 
        tooltips: true,  
        step: 1,
        range: {
            min: 0,
            max: arrays1[1].length - 1
          },
        format: {
            to: function (value) {
                return arrays1[1][Math.round(value)];
            },
            from: function (value) {
                return arrays1[1].indexOf(value);
            }
        }
    });

    // Helper to update slider labels to show remaining axes
    function updateSliderLabels() {
        // indices are calculated in animate(), but we need to update labels here as well
        const remaining = [0, 1, 2, 3].filter(i => !options.includes(i));
        document.getElementById('slider1-label').textContent = axis_labels[remaining[0]] + ': ';
        document.getElementById('slider2-label').textContent = axis_labels[remaining[1]] + ': ';
    }

    function animate() {
        if(updated_axis){
            updated_axis = false;
            indices = [0, 1, 2, 3].filter(element => !options.includes(element));
            arrays1 = [x_xi_t_Q2_array[options[0]], x_xi_t_Q2_array[options[1]]];// x, t
            arrays2 = [x_xi_t_Q2_array[indices[0]], x_xi_t_Q2_array[indices[1]]]; // xi, Q2

            [min_xi, max_xi] = get_extreme(arrays2[0]); // xi
            [min_Q2, max_Q2] = get_extreme(arrays2[1]); // Q2

            slider_1.noUiSlider.updateOptions({
                range: {
                  min: 0,
                  max: arrays1[0].length - 1
                },
                format: {
                  to: function (value) {
                      return arrays1[0][Math.round(value)];
                  },
                  from: function (value) {
                      return arrays1[0].indexOf(value);
                  }
                }
            });

            slider_2.noUiSlider.updateOptions({
                range: {
                  min: 0,
                  max: arrays1[1].length - 1
                },
                format: {
                  to: function (value) {
                      return arrays1[1][Math.round(value)];
                  },
                  from: function (value) {
                      return arrays1[1].indexOf(value);
                  }
                }
            });

            // Update slider labels to show remaining axes
            updateSliderLabels();

            // console.log(arrays2[0].length, arrays2[1].length)
            scene = new THREE.Scene()
            geometry = new THREE.PlaneGeometry(1, 1, arrays2[0].length - 1, arrays2[1].length - 1);
            let plane = new THREE.Mesh(geometry, material)
            let global_axis = create_axis(new THREE.Vector3(0, 0, 0), 3.0, 2.0, axis_labels[indices[0]], axis_labels[indices[1]], "GPD")
            global_axis.forEach(element => {
                scene.add(element)
            });
            scene.add(plane)
            scene.add(dir_light);
            scene.add(ambient_light); 
        
            axis_scene = new THREE.Scene()
            let orient_axis = create_axis(new THREE.Vector3(0, 0, 0), 8.0, 0.5, axis_labels[indices[0]], axis_labels[indices[1]], "GPD")
            orient_axis.forEach(element => {
                axis_scene.add(element);
            });

            positions = geometry.attributes.position;
            colors = new Float32Array(positions.count * 3)
            for (let i = 0; i < positions.count; i++) {
                let Q2_index = Math.floor(i / arrays2[0].length)
                let xi_index = i % arrays2[0].length // xi
                let Q2_value = (arrays2[1][Q2_index] - min_Q2) / (max_Q2 - min_Q2)
                let xi_value = (arrays2[0][xi_index] - min_xi) / (max_xi - min_xi)
                positions.setX(i, xi_value);
                positions.setY(i, Q2_value);
            }
            
            // Set the controls target to the center of the data surface
            controls.target.set(0.5, 0.5, 0.5);
            controls.update();
        }

        // console.log(control_index)

        if(slider_changed){
            slider_changed = false
            for (let i = 0; i < positions.count; i++) {
                let Q2_index = Math.floor(i / arrays2[0].length)
                let xi_index = i % arrays2[0].length
                let query_index = [0, 0, 0, 0]
                query_index[options[0]] = control_index[0]
                query_index[options[1]] = control_index[1]
                query_index[indices[0]] = xi_index
                query_index[indices[1]] = Q2_index
                let gpd_value = (gpd_4d.get(query_index[0], query_index[1], query_index[2], query_index[3]) - min_gpd) / (max_gpd - min_gpd);
                positions.setZ(i, gpd_value);
                let color = evaluate_cmap(gpd_value, 'viridis', false);

                colors[i * 3] = color[0] / 255.;
                colors[i * 3 + 1] = color[1] / 255.;
                colors[i * 3 + 2] = color[2] / 255.;
            }
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            positions.needsUpdate = true;
            geometry.computeVertexNormals();
        }

        renderer.setViewport(0, 0, container.clientWidth, container.clientHeight)
        controls.update()
        renderer.clear();
        renderer.render( scene, camera );

        renderer.clearDepth();  
        renderer.autoClear = false;
        renderer.setViewport(0, 0, 300, 300);
        axis_camera.position.copy(camera.position); 
        axis_camera.quaternion.copy(camera.quaternion);
        axis_camera.position.normalize();
        renderer.render(axis_scene, axis_camera);
    }

    renderer.setAnimationLoop( animate );

    window.addEventListener('resize', function() {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });
    
    slider_1.noUiSlider.on('change', function(values, handle) {
        control_index[0] = Math.round(arrays1[0].indexOf(parseFloat(values[0])));
        slider_changed = true;
    });
    slider_2.noUiSlider.on('change', function(values, handle) {
        control_index[1] = Math.round(arrays1[1].indexOf(parseFloat(values[0])));
        slider_changed = true;
    });

    // Set a callback function to run when the selection changes
    dropdown1.addEventListener('change', function() {
        const selectedValue = Number(dropdown1.value);
        if (selectedValue == options[1]){
            showNotification("Please select two different axes!", "warning");
            dropdown1.value = options[0]
            return
        }
        options[0] = selectedValue;
        updated_axis = true;
        slider_changed = true;
        control_index = [0, 0];
        slider_1.noUiSlider.set(0);
        showNotification(`Primary axis changed to ${axis_labels[selectedValue]}`, "success");
        updateSliderLabels();
    });

    dropdown2.addEventListener('change', function() {
        const selectedValue = Number(dropdown2.value);
        if (selectedValue == options[0]){
            showNotification("Please select two different axes!", "warning");
            dropdown2.value = options[1];
            return;
        }
        options[1] = selectedValue;
        updated_axis = true;
        slider_changed = true;
        control_index = [0, 0];
        slider_2.noUiSlider.set(0);
        showNotification(`Secondary axis changed to ${axis_labels[selectedValue]}`, "success");
        updateSliderLabels();
    });

    updateSliderLabels();
})

// Add notification system
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // Get the main content container
    const mainContent = document.getElementById('main-content');
    const rect = mainContent.getBoundingClientRect();
    
    Object.assign(notification.style, {
        position: 'fixed',
        top: `${rect.top + rect.height / 2 - 30}px`, // Center vertically in main-content
        left: `${rect.left + rect.width / 2}px`,     // Center horizontally in main-content
        transform: 'translateX(-50%)',               // Center the notification itself
        padding: '15px 20px',
        borderRadius: '5px',
        color: 'white',
        zIndex: '10001',
        fontSize: '14px',
        fontWeight: '500',
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
        backgroundColor: type === 'success' ? '#4CAF50' : type === 'warning' ? '#FF9800' : '#2196F3',
        textAlign: 'center',
        minWidth: '200px'
    });
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}
