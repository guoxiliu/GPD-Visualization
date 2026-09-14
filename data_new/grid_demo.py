import numpy as np
import matplotlib as mpl
import matplotlib.pyplot as py
mpl.rc('font',size=26,family='cmr10',weight='normal')
mpl.rc('text',usetex=True)
mpl.rc('text.latex', preamble=r"\usepackage{bm,amsmath,amssymb,amsfonts,mathrsfs}")
mpl.rc('axes.formatter', use_mathtext=True)


def replica_demo_1d(input_gpd_file="gpd_x_xi_t_Q2_r.npy", output_file="gpd_1d.pdf"):
    x_2d  = np.load("x_grid.npy")
    xi_1d = np.load("xi_array.npy")
    t_1d  = np.load("t_array.npy")
    Q2_1d = np.load("Q2_array.npy")
    H_5d  = np.load(input_gpd_file)
    print(xi_1d)
    # The shape of x_2d is (nx, nxi)
    print(x_2d.shape)
    print(H_5d.shape[0], H_5d.shape[1])
    # Each slide of x_2d corresponds to a different xi value
    # To plot some replicas at a fixed xi...
    i_xi = 76
    xi_val = xi_1d[i_xi]
    x_array = x_2d[:,i_xi]
    print(xi_val)
    nrows,ncols=1,1
    fig = py.figure(figsize=(11,7),layout='constrained')
    ax = py.subplot(nrows,ncols,1)
    for n in range(H_5d.shape[-1]):
        ax.plot(x_array, H_5d[:,i_xi,0,0,n], '-', color='xkcd:forest green', alpha=0.3)
    ax.set_xlim((-1,1)) 
    ax.set_xlabel(r'$x$')
    ax.set_ylabel(r'$GPD(x,\xi,t,Q^2)$')
    fig.savefig(output_file)
    return

def replica_demo_2d(input_gpd_file="gpd_x_xi_t_Q2_r.npy", output_file="gpd_2d.pdf"):
    x_2d  = np.load("x_grid.npy")
    xi_1d = np.load("xi_array.npy")
    t_1d  = np.load("t_array.npy")
    Q2_1d = np.load("Q2_array.npy")
    H_5d  = np.load(input_gpd_file)
    print(xi_1d)
    # The shape of x_2d is (nx, nxi)
    print(x_2d.shape)
    print(H_5d.shape[0], H_5d.shape[1])
    # To make a pixel plot, instead of meshing independent x and xi arrays...
    nx = x_2d.shape[0]
    xi_2d = np.repeat(xi_1d[np.newaxis,:], nx, axis=0)
    print("xi_2d shape:", xi_2d.shape)
    nrows,ncols=1,1
    fig = py.figure(figsize=(11,7),layout='constrained')
    ax = py.subplot(nrows,ncols,1,aspect='equal')
    image = ax.pcolormesh(x_2d, xi_2d, H_5d[:,:,0,0,0],
                          cmap='vanimo',
                          vmax = 10, vmin = -10,
                          linewidth=1, rasterized=False)
    ax.set_xlim((-1,1))
    ax.set_ylim((0,1))
    ax.set_xlabel(r'$x$')
    ax.set_ylabel(r'$\xi$')
    fig.savefig(output_file)
    return


def readData():
    x_2d  = np.load("x_grid.npy")
    xi_1d = np.load("xi_array.npy")
    t_1d  = np.load("t_array.npy")
    Q2_1d = np.load("Q2_array.npy")
    H_5d  = np.load("gpd_x_xi_t_Q2_r.npy")

    print("x_2d shape:", x_2d.shape)
    print("xi_1d shape:", xi_1d.shape)
    print("t_1d shape:", t_1d.shape)
    print("Q2_1d shape:", Q2_1d.shape)
    print("H_5d shape:", H_5d.shape)
    print(H_5d[0][0][0][0])


def downsample_gpd_replicas(n_replicas=3, output_filename=None):
    try:
        import os
        if output_filename is None:
            output_filename = f"gpd_x_xi_t_Q2_r_small_{n_replicas}r.npy" if n_replicas != 5 else "gpd_x_xi_t_Q2_r_small.npy"
        
        # Load from original 20-replica array using memory mapping
        src = "gpd_x_xi_t_Q2_r.npy" if os.path.exists("gpd_x_xi_t_Q2_r.npy") else "gpd_x_xi_t_Q2_r_small.npy"
        print(f"Loading from {src}...")
        data = np.load(src, mmap_mode='r')

        # Slice n_replicas and convert to float32
        small_data = data[..., :n_replicas].astype(np.float32)
        np.save(output_filename, small_data)

        print(f"Saved {output_filename} successfully.")
        print(f"Shape: {small_data.shape}, dtype: {small_data.dtype}")

    except Exception as e:
        print(f"An error occurred: {e}")


if __name__ == "__main__":
    # readData()
    # downsample_gpd_replicas(5, "gpd_x_xi_t_Q2_r_small.npy")
    # downsample_gpd_replicas(3, "gpd_x_xi_t_Q2_r_small_3r.npy")

    # replica_demo_1d()
    replica_demo_1d("gpd_x_xi_t_Q2_r_small.npy", "gpd_1d_small.pdf")
    # replica_demo_2d()
    replica_demo_2d("gpd_x_xi_t_Q2_r_small.npy", "gpd_2d_small.pdf")

    print("Done")

