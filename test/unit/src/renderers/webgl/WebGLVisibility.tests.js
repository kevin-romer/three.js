import { WebGLRenderer, WebGLRenderTarget, Scene, OrthographicCamera, PlaneGeometry, Mesh, MeshBasicMaterial, Line, LineBasicMaterial, Points, PointsMaterial, Sprite, SpriteMaterial, InstancedMesh, Matrix4 } from '../../../../../src/Three.js';

function fixture() {

	const renderer = new WebGLRenderer();
	renderer.setSize( 16, 16 );
	const scene = new Scene();
	const camera = new OrthographicCamera( - 1, 1, 1, - 1, 0.1, 10 );
	camera.position.z = 2;
	return { renderer, scene, camera,
		render() {

			renderer.render( scene, camera );
			return renderer.info.render.calls;

		},
		dispose() {

			scene.traverse( object => {

				object.geometry?.dispose();
				const materials = Array.isArray( object.material ) ? object.material : [ object.material ];
				for ( const material of materials ) material?.dispose();
				if ( object.isInstancedMesh ) object.dispose();

			} );
			renderer.dispose();
			renderer.forceContextLoss();

		}
	};

}

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'WebGLVisibility', () => {

		const canvas = document.createElement( 'canvas' );
		const context = canvas.getContext( 'webgl2' );
		const gpuTest = context ? QUnit.test : QUnit.skip;
		context?.getExtension( 'WEBGL_lose_context' )?.loseContext();

		gpuTest( 'hidden materials defer geometry and instance uploads but preserve visible children', assert => {

			const f = fixture();
			try {

				const objects = [
					new Mesh( new PlaneGeometry(), new MeshBasicMaterial() ),
					new Line( new PlaneGeometry(), new LineBasicMaterial() ),
					new Points( new PlaneGeometry(), new PointsMaterial() ),
					new InstancedMesh( new PlaneGeometry(), new MeshBasicMaterial(), 1 ),
					new Sprite( new SpriteMaterial() )
				];
				// Avoid the globally shared sprite geometry in this ownership test.
				objects[ 4 ].geometry = new PlaneGeometry();
				objects[ 3 ].setMatrixAt( 0, new Matrix4() );
				const uploads = objects.map( () => 0 );
				let instanceUploads = 0;
				objects[ 3 ].instanceMatrix.onUpload( () => instanceUploads ++ );
				objects.forEach( ( object, index ) => {

					object.frustumCulled = false;
					object.material.visible = false;
					object.geometry.attributes.position.onUpload( () => uploads[ index ] ++ );
					f.scene.add( object );

				} );
				const child = new Mesh( new PlaneGeometry( 2, 2 ), new MeshBasicMaterial( { color: 0xff0000 } ) );
				objects[ 0 ].add( child );
				assert.strictEqual( f.render(), 1, 'A hidden parent material does not hide its child' );
				assert.deepEqual( uploads, [ 0, 0, 0, 0, 0 ], 'No hidden geometry upload callbacks' );
				assert.strictEqual( instanceUploads, 0, 'No hidden instance upload' );
				assert.strictEqual( f.renderer.info.memory.geometries, 1 );

				const gl = f.renderer.getContext(), pixel = new Uint8Array( 4 );
				gl.readPixels( 8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel );
				assert.deepEqual( Array.from( pixel ), [ 255, 0, 0, 255 ], 'Visible child is rendered' );
				for ( const object of objects ) object.material.visible = true;
				assert.strictEqual( f.render(), 6 );
				assert.deepEqual( uploads, [ 1, 1, 1, 1, 1 ], 'Deferred uploads happen when revealed' );
				assert.strictEqual( instanceUploads, 1 );
				for ( const object of objects ) {

					object.material.visible = false;
					object.geometry.attributes.position.needsUpdate = true;

				}

				objects[ 3 ].instanceMatrix.needsUpdate = true;
				f.render();
				assert.deepEqual( uploads, [ 1, 1, 1, 1, 1 ], 'Dirty hidden attributes stay deferred' );
				assert.strictEqual( instanceUploads, 1 );
				for ( const object of objects ) object.material.visible = true;
				f.render();
				assert.deepEqual( uploads, [ 2, 2, 2, 2, 2 ] );
				assert.strictEqual( instanceUploads, 2 );
				assert.strictEqual( gl.getError(), gl.NO_ERROR );

			} finally {

				f.dispose();

			}

		} );

		gpuTest( 'material arrays keep group visibility and upload semantics', assert => {

			const f = fixture();
			try {

				const geometry = new PlaneGeometry();
				geometry.clearGroups();
				geometry.addGroup( 0, 3, 0 );
				geometry.addGroup( 3, 3, 1 );
				const materials = [ new MeshBasicMaterial(), new MeshBasicMaterial() ];
				for ( const material of materials ) material.visible = false;
				let uploads = 0;
				geometry.attributes.position.onUpload( () => uploads ++ );
				const mesh = new Mesh( geometry, materials );
				f.scene.add( mesh );
				assert.strictEqual( f.render(), 0 );
				assert.strictEqual( uploads, 1, 'Array materials keep the existing preparation path' );
				materials[ 1 ].visible = true;
				assert.strictEqual( f.render(), 1, 'One visible group' );
				materials[ 0 ].visible = true;
				assert.strictEqual( f.render(), 2, 'Both visible groups' );

			} finally {

				f.dispose();

			}

		} );

		gpuTest( 'shared geometry still uploads for a visible child and render target', assert => {

			const f = fixture(), target = new WebGLRenderTarget( 16, 16 );
			try {

				const geometry = new PlaneGeometry( 2, 2 );
				let uploads = 0;
				geometry.attributes.position.onUpload( () => uploads ++ );
				const parent = new Mesh( geometry, new MeshBasicMaterial( { visible: false } ) );
				parent.add( new Mesh( geometry, new MeshBasicMaterial( { color: 0x00ff00 } ) ) );
				f.scene.add( parent );
				f.renderer.setRenderTarget( target );
				assert.strictEqual( f.render(), 1 );
				assert.strictEqual( uploads, 1, 'A visible consumer uploads shared geometry' );
				const pixel = new Uint8Array( 4 );
				f.renderer.readRenderTargetPixels( target, 8, 8, 1, 1, pixel );
				assert.deepEqual( Array.from( pixel ), [ 0, 255, 0, 255 ] );
				parent.material.visible = true;
				assert.strictEqual( f.render(), 2 );
				assert.strictEqual( uploads, 1, 'Revealing an unchanged shared attribute avoids another upload' );

			} finally {

				f.renderer.setRenderTarget( null );
				target.dispose();
				f.dispose();

			}

		} );

	} );

} );
