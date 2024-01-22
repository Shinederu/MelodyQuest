/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Main.java to edit this template
 */
package app;

import ctrl.Ctrl;
import ihm.Ihm;
import wrk.Wrk;

/**
 *
 * @author shine
 */
public class MelodyQuest {

    /**
     * @param args the command line arguments
     */
    public static void main(String[] args) {
        
        Wrk wrk = new Wrk();
        Ihm ihm = new Ihm();
        Ctrl ctrl = new Ctrl(wrk, ihm);
        wrk.setRefCtrl(ctrl);
        ihm.setRefCtrl(ctrl);
        
        ctrl.start();
        
    }
    
}
